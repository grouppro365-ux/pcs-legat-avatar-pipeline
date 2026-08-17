#!/usr/bin/env python3
import json, re, ssl, time, urllib.request, urllib.error, urllib.parse
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed

UA='SEOFleetDiscovery/1.0'
URLS=[
'https://ampliv.ru','https://ambitix.ru','https://aspirix.ru/','https://biz-focus.ru','http://bizhubnews.ru','https://biz-report.ru','https://bizupdate.ru','https://biz-world.ru','https://businessherald.ru','http://business-arena.ru','https://business-focus.ru','https://businessbrief.ru/','https://businessjournalist.ru','https://businessherald.online','http://capitrx.ru/','https://clariva.ru','https://commerce-hub.ru','http://contenia.ru','https://corporatenews.ru','http://corporatehub.ru','http://corporatepulse.ru','https://crescix.ru','https://journalprobiz.online','https://inspireo.ru','https://innoviq.ru','https://innovoe.ru','https://industry-digest.ru','http://industryreport.ru','https://industryfocus.ru','https://industrydigest.ru','https://growvia.online','https://groviva.ru','https://fortunea.ru','https://focusix.ru','https://flourix.ru','https://excellix.ru','https://entreva.online','https://entreva.ru','https://entrepreneursphere.online','https://entrepreneursphere.ru','https://enterpriseupdate.ru','https://enterprisenews.ru','http://enterprisevoice.ru','https://empowix.ru','https://econreport.ru','https://prowessa.ru','https://proentrepreneur.ru','https://proentrepreneur.online','https://primevo.ru','https://pressarena.ru','https://pioneerx.ru','https://peakvia.ru','https://optivae.online','https://optivae.ru','https://newsida.ru','https://mediashot.ru','https://legat-herald.ru','https://legatpro.ru','https://legatbusiness.online','https://legatbusiness.ru','https://legatnews.ru','https://legatjournal.ru','http://legatpro.online','https://legatprobiz.ru','https://legatjournal.online','https://legacix.ru','https://jurnet.ru','https://journalprobiz.ru','https://journalbiz.ru','https://journalbiz.online','https://visiuma.ru','https://visiown.ru','https://vantagex.ru','https://vantagex.online','https://uptrive.ru','https://triumphx.ru','https://trenddigest.ru','http://trendupdate.ru','https://topentrepreneur.online','https://topentrepreneur.ru','https://topambassador.online','https://topambassador.ru','https://synerix.ru','https://successa.ru','https://striveon.ru','https://statusday.ru','https://startupchronicle.ru','http://startup-daily.ru','http://startupchronicle.online','http://startup-life.ru','https://startupdigest.ru','https://scrollix.ru','https://reputon.ru','https://questix.ru','https://publixis.ru','https://ignitix.ru','https://pressflow.ru']
UNRESOLVED=['Corporate View','Growvia','Genuity','Legat Herald новости','LegatProBiz']
KNOWN_DONE={'ambitix.ru','aspirix.ru','biz-focus.ru','biz-report.ru','bizupdate.ru','biz-world.ru','businessherald.ru','business-arena.ru','business-focus.ru','bizcenter-news.ru'}

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.intitle=False; self.title=[]; self.inh1=False; self.h1=[]; self.h1s=[]; self.meta={}; self.canonical=None
    def handle_starttag(self,tag,attrs):
        d={k.lower():(v or '') for k,v in attrs}; tag=tag.lower()
        if tag=='title': self.intitle=True
        elif tag=='h1': self.inh1=True; self.h1=[]
        elif tag=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k: self.meta[k]=d.get('content','').strip()
        elif tag=='link' and 'canonical' in d.get('rel','').lower().split(): self.canonical=d.get('href','').strip()
    def handle_endtag(self,tag):
        tag=tag.lower()
        if tag=='title': self.intitle=False
        elif tag=='h1':
            self.inh1=False; v=' '.join(''.join(self.h1).split())
            if v: self.h1s.append(v)
    def handle_data(self,d):
        if self.intitle: self.title.append(d)
        if self.inh1: self.h1.append(d)
    def result(self):
        return {'title':' '.join(''.join(self.title).split()),'description':self.meta.get('description'),'robots':self.meta.get('robots'),'canonical':self.canonical,'h1s':self.h1s}

def req(url,timeout=12):
    r=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*','Cache-Control':'no-cache'})
    t=time.time()
    try:
        with urllib.request.urlopen(r,timeout=timeout,context=ssl.create_default_context()) as x:
            return {'status':x.status,'url':x.geturl(),'headers':dict(x.headers),'body':x.read(1800000).decode('utf-8','replace'),'ms':round((time.time()-t)*1000)}
    except urllib.error.HTTPError as e:
        return {'status':e.code,'url':getattr(e,'url',url),'headers':dict(e.headers or {}),'body':e.read(700000).decode('utf-8','replace'),'error':f'HTTP {e.code}','ms':round((time.time()-t)*1000)}
    except Exception as e:
        return {'status':None,'url':url,'error':type(e).__name__+': '+str(e)[:180],'ms':round((time.time()-t)*1000)}

def html(url):
    r=req(url); p=P()
    try: p.feed(r.get('body',''))
    except Exception: pass
    z=p.result(); z.update({k:r.get(k) for k in ('status','url','ms','error') if r.get(k) is not None}); return z

def host(u):
    try: return (urllib.parse.urlsplit(u).hostname or '').lower().removeprefix('www.')
    except Exception: return ''

def noindex(v): return 'noindex' in (v or '').lower()

def audit(raw):
    d=host(raw); base='https://'+d
    out={'domain':d,'source_url':raw,'known_done':d in KNOWN_DONE,'checks':{},'issues':[]}
    hv=[]
    for u in [f'http://{d}/',f'https://{d}/']:
        r=req(u); hv.append({'input':u,'status':r.get('status'),'final':r.get('url'),'error':r.get('error')})
    out['host_variants']=hv
    home=html(base+'/'); out['homepage']=home
    c=out['checks']
    c['reachable']=home.get('status')==200
    c['https_preferred']=all(x.get('status')==200 and (x.get('final') or '').startswith(f'https://{d}') for x in hv)
    c['title_present']=bool(home.get('title'))
    c['description_present']=bool(home.get('description'))
    c['canonical_self']=host(home.get('canonical',''))==d
    c['home_indexable']=not noindex(home.get('robots'))
    c['single_h1']=len(home.get('h1s',[]))==1
    rr=req(base+'/robots.txt'); rb=rr.get('body',''); sms=re.findall(r'(?im)^\s*Sitemap:\s*(\S+)',rb)
    out['robots']={'status':rr.get('status'),'sitemaps':sms,'disallow_root':bool(re.search(r'(?im)^\s*Disallow:\s*/\s*$',rb))}
    c['robots_ok']=rr.get('status')==200 and not out['robots']['disallow_root'] and any(host(x)==d for x in sms)
    sm=req(base+'/sitemap_index.xml'); locs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',sm.get('body',''),re.I); tags=[x for x in locs if 'post_tag-sitemap' in x]
    bust=req(base+'/sitemap_index.xml?_fleet='+str(int(time.time()))); blocs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',bust.get('body',''),re.I); btags=[x for x in blocs if 'post_tag-sitemap' in x]
    out['sitemap']={'status':sm.get('status'),'children':locs[:40],'tag_sitemaps_plain':tags,'cache_busted_status':bust.get('status'),'tag_sitemaps_cache_busted':btags,'foreign_children':[x for x in locs if host(x)!=d]}
    c['sitemap_ok']=sm.get('status')==200 and bool(locs) and not out['sitemap']['foreign_children']
    c['no_tag_sitemaps']=not tags and bust.get('status')==200 and not btags
    wr=req(base+'/wp-json/'); root=None
    try: root=json.loads(wr.get('body',''))
    except Exception: pass
    rankmath=isinstance(root,dict) and any(str(x).startswith('rankmath/') for x in root.get('namespaces',[]))
    out['wp']={'status':wr.get('status'),'rankmath':rankmath}
    c['rankmath_rest']=wr.get('status')==200 and rankmath
    pr=req(base+'/wp-json/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=link,status,date,modified'); posts=None
    try: posts=json.loads(pr.get('body',''))
    except Exception: pass
    if isinstance(posts,list) and posts:
        out['sample_post_ref']=posts[0]; ph=html(posts[0].get('link')) if posts[0].get('link') else {}; out['sample_post']=ph
        c['sample_post_ok']=ph.get('status')==200 and not noindex(ph.get('robots')) and host(ph.get('canonical',''))==d and bool(ph.get('title'))
    else:
        out['sample_post_ref']=None; c['sample_post_ok']=False
    for k,v in c.items():
        if not v: out['issues'].append(k)
    out['issue_count']=len(out['issues']); out['pass_structural']=not out['issues']
    return out

def main():
    started=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    sites=[]
    with ThreadPoolExecutor(max_workers=14) as ex:
        fut={ex.submit(audit,u):u for u in URLS}
        for f in as_completed(fut):
            try: sites.append(f.result())
            except Exception as e: sites.append({'domain':host(fut[f]),'source_url':fut[f],'fatal':type(e).__name__+': '+str(e)[:250],'issues':['fatal'],'issue_count':1,'pass_structural':False})
    order=[host(u) for u in URLS]; sites.sort(key=lambda x:order.index(x['domain']))
    buckets={k:[] for k in ['reachable','https_preferred','title_present','description_present','canonical_self','home_indexable','single_h1','robots_ok','sitemap_ok','no_tag_sitemaps','rankmath_rest','sample_post_ok']}
    for s in sites:
        for k in buckets:
            if not s.get('checks',{}).get(k,False): buckets[k].append(s['domain'])
    report={'mode':'fleet_discovery','started_at':started,'source_rows':102,'audited_url_rows':len(URLS),'unresolved_sheet_entries':UNRESOLVED,'known_done_in_sheet':sorted(set(order)&KNOWN_DONE),'sites':sites,'summary':{'audited':len(sites),'clean_structural':sum(bool(s.get('pass_structural')) for s in sites),'with_issues':sum(not bool(s.get('pass_structural')) for s in sites),'issue_buckets':buckets},'finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    json.dump(report,open('seo-fleet-discovery.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'audited':len(sites),'clean':report['summary']['clean_structural'],'with_issues':report['summary']['with_issues'],'unresolved':len(UNRESOLVED),'bucket_counts':{k:len(v) for k,v in buckets.items()}},ensure_ascii=False))

if __name__=='__main__': main()
