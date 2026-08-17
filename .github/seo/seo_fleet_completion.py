#!/usr/bin/env python3
import json, time, ssl, urllib.request, urllib.error, collections
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import seo_fleet_discovery as base

RESOLVED={
    'Corporate View':'corporateview.ru',
    'Growvia':'growvia.ru',
    'Genuity':'genuity.ru',
    'Legat Herald новости':'legatherald.online',
    'LegatProBiz':'legatprobiz.online',
}
STANDARD_PREFIXES=('wp/','oembed/','rankmath/','elementor/','contact-form-7/','yoast/','jetpack/','wp-site-health/','wp-block-editor/')
SUSPECT=('bridge','legat','media','dispatcher','agency','seo','remote','sync','publish','content','fleet','network','portal')
UA='SEOFleetCompletion/1.0'
ROOT=Path(__file__).resolve().parents[2]

def jget(domain):
    url=f'https://{domain}/wp-json/'
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json','Cache-Control':'no-cache'})
    try:
        with urllib.request.urlopen(req,timeout=14,context=ssl.create_default_context()) as r:
            obj=json.loads(r.read(3500000).decode('utf-8','replace'))
            return r.status,obj,None
    except urllib.error.HTTPError as e:
        return e.code,None,f'HTTP {e.code}'
    except Exception as e:
        return None,None,type(e).__name__+': '+str(e)[:180]

def bridge_probe(domain):
    st,obj,err=jget(domain)
    out={'domain':domain,'status':st,'error':err,'namespaces':[],'nonstandard_namespaces':[],'suspect_namespaces':[],'suspect_routes':[]}
    if not isinstance(obj,dict): return out
    ns=[str(x) for x in obj.get('namespaces',[])]; out['namespaces']=ns
    non=[]
    for n in ns:
        if not n.startswith(STANDARD_PREFIXES) and n not in ('wp/v2','oembed/1.0'):
            non.append(n)
    out['nonstandard_namespaces']=non
    out['suspect_namespaces']=[n for n in ns if any(k in n.lower() for k in SUSPECT)]
    routes=obj.get('routes') or {}
    if isinstance(routes,dict):
        for path,meta in routes.items():
            low=str(path).lower()
            if any(k in low for k in SUSPECT):
                methods=[]
                if isinstance(meta,dict):
                    methods=meta.get('methods') or []
                    if isinstance(methods,dict): methods=list(methods)
                out['suspect_routes'].append({'path':path,'methods':methods})
    return out

def main():
    prior_path=ROOT/'.seo-runner'/'fleet-discovery.json'
    prior=json.load(open(prior_path,encoding='utf-8'))
    added=[]
    with ThreadPoolExecutor(max_workers=5) as ex:
        fut={ex.submit(base.audit,'https://'+d):label for label,d in RESOLVED.items()}
        for f in as_completed(fut):
            label=fut[f]
            try:
                x=f.result(); x['resolved_from_sheet_label']=label; added.append(x)
            except Exception as e:
                d=RESOLVED[label]; added.append({'domain':d,'resolved_from_sheet_label':label,'fatal':type(e).__name__+': '+str(e)[:250],'issues':['fatal'],'issue_count':1,'pass_structural':False})
    added.sort(key=lambda x:list(RESOLVED.values()).index(x['domain']))
    sites=(prior.get('sites') or [])+added
    domains=[x.get('domain') for x in sites if x.get('domain')]
    probes=[]
    with ThreadPoolExecutor(max_workers=14) as ex:
        fut={ex.submit(bridge_probe,d):d for d in domains}
        for f in as_completed(fut):
            try: probes.append(f.result())
            except Exception as e: probes.append({'domain':fut[f],'status':None,'error':type(e).__name__+': '+str(e)[:180]})
    probes.sort(key=lambda x:domains.index(x['domain']))
    freq=collections.Counter()
    for p in probes:
        for n in p.get('nonstandard_namespaces',[]): freq[n]+=1
    suspicious=[p for p in probes if p.get('suspect_namespaces') or p.get('suspect_routes')]
    buckets=collections.defaultdict(list)
    for s in sites:
        for issue in s.get('issues') or []: buckets[issue].append(s['domain'])
    clean=[s['domain'] for s in sites if s.get('pass_structural')]
    report={
        'mode':'fleet_completion_102_and_bridge_discovery',
        'started_from_report':prior.get('started_at'),
        'resolved_sheet_entries':RESOLVED,
        'audited_total':len(sites),
        'clean_structural':len(clean),
        'with_issues':len(sites)-len(clean),
        'issue_bucket_counts':{k:len(v) for k,v in sorted(buckets.items())},
        'issue_buckets':dict(sorted(buckets.items())),
        'added_sites':added,
        'bridge_discovery':{
            'wp_json_reachable':sum(p.get('status')==200 for p in probes),
            'namespace_frequency':dict(freq.most_common()),
            'suspicious_sites':suspicious,
            'all_probes':probes,
        },
        'finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    }
    json.dump(report,open('seo-fleet-completion.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'audited_total':report['audited_total'],'clean':report['clean_structural'],'with_issues':report['with_issues'],'added':[(x['domain'],x.get('issues')) for x in added],'wp_json_reachable':report['bridge_discovery']['wp_json_reachable'],'suspicious_sites':len(suspicious),'top_nonstandard':freq.most_common(12)},ensure_ascii=False))

if __name__=='__main__': main()
