#!/usr/bin/env python3
import base64, json, os, subprocess, time, urllib.request, urllib.error, ssl

def http_json(url, auth=None):
    headers={'Accept':'application/json','User-Agent':'SEORepairPreflight/1.0'}
    if auth:
        token=base64.b64encode((auth[0]+':'+auth[1]).encode()).decode()
        headers['Authorization']='Basic '+token
    req=urllib.request.Request(url,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=20,context=ssl.create_default_context()) as r:
            return r.status,json.loads(r.read().decode('utf-8','replace'))
    except urllib.error.HTTPError as e:
        return e.code,None
    except Exception:
        return None,None

def ftps_list(host,user,password,path=''):
    url=f"ftp://{host}/{path.strip('/')}/" if path else f"ftp://{host}/"
    cmd=['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','12','--max-time','25',
         '--user',f'{user}:{password}','--list-only',url]
    p=subprocess.run(cmd,capture_output=True,text=True)
    if p.returncode!=0:
        return None,(p.stderr or '').strip()[:300]
    return [x.strip().rstrip('/') for x in p.stdout.splitlines() if x.strip()],None

def find_wp_root(host,user,password,domain,root_entries):
    candidates=[]
    names=[x.rstrip('/').split('/')[-1] for x in root_entries or []]
    for n in names:
        if domain.lower() in n.lower() or n.lower() in domain.lower():
            candidates += [f'{n}/public_html', n]
    candidates += [f'{domain}/public_html',domain,f'public_html/{domain}']
    seen=set()
    probes=[]
    for p in candidates:
        if not p or p in seen: continue
        seen.add(p)
        listing,err=ftps_list(host,user,password,p)
        probes.append({'path':p,'ok':listing is not None,'error':err})
        if listing is not None and 'wp-load.php' in listing and 'wp-config.php' in listing:
            return p,probes
    return None,probes

def main():
    cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8'))
    out={'mode':'preflight','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'ftp':{},'sites':[]}
    b=cfg.get('beget') or {}
    host=None; root=None
    for h in b.get('hosts',[]):
        root,err=ftps_list(h,b.get('user',''),b.get('password',''))
        out['ftp'].setdefault('attempts',[]).append({'host':h,'ok':root is not None,'error':err})
        if root is not None:
            host=h; break
    out['ftp']['connected']=host is not None
    out['ftp']['host']=host
    out['ftp']['root_entries']=root[:300] if root else []
    for site in cfg.get('sites',[]):
        d=site['domain']; base='https://'+d
        item={'domain':d}
        st,wp=http_json(base+'/wp-json/')
        item['wp_status']=st
        if isinstance(wp,dict):
            front=int(wp.get('page_on_front') or 0)
            item['show_on_front']=wp.get('show_on_front'); item['front_id']=front
            app=(site.get('app_password') or '').replace(' ','')
            if app and front:
                ps,p=http_json(f'{base}/wp-json/wp/v2/pages/{front}?context=edit',auth=(site.get('wp_user','adminnp'),app))
                item['front_edit_status']=ps
                if isinstance(p,dict):
                    meta=p.get('meta') or {}
                    item['rankmath_meta']={k:v for k,v in meta.items() if 'rank_math' in str(k).lower()}
                    item['page_title_raw']=((p.get('title') or {}).get('raw') if isinstance(p.get('title'),dict) else None)
        if host:
            path,probes=find_wp_root(host,b['user'],b['password'],d,root)
            item['ftp_wp_path']=path
            item['ftp_probe_count']=len(probes)
            item['ftp_probe_errors']=[x for x in probes if not x['ok']][:10]
        out['sites'].append(item)
    out['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(out,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'ok':True,'ftp_connected':out['ftp'].get('connected'),'mapped':sum(bool(x.get('ftp_wp_path')) for x in out['sites'])}))
if __name__=='__main__': main()
