#!/usr/bin/env python3
import json,re,ssl,time,urllib.request,urllib.error,urllib.parse
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor,as_completed

UA='SEOFinalVerification/1.0'
SITES=[
('ambitix.ru','Ambitix об амбициях, выборе и росте бизнеса','Ambitix об амбициях, выборе и росте бизнеса. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для бизнеса.'),
('aspirix.ru','Aspirix о запуске идей и обновлении проектов','Aspirix о запуске идей и обновлении проектов. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для осознанного выбора.'),
('biz-focus.ru','Biz Focus о решениях собственников и цене управленческих ошибок','Biz Focus о решениях собственников и цене управленческих ошибок. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума.'),
('bizcenter-news.ru','Bizcenter News о компаниях, деловой инфраструктуре и офисной среде','Bizcenter News о компаниях, деловой инфраструктуре и офисной среде. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума.'),
('biz-report.ru','Biz Report о цифрах, рынках и результатах компаний','Biz Report о цифрах, рынках и результатах компаний. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для бизнеса.'),
('bizupdate.ru','Bizupdate об изменениях компаний, продуктов и рынков','Bizupdate об изменениях компаний, продуктов и рынки. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для бизнеса.'),
('biz-world.ru','Biz World о международных рынках и деловых возможностях','Biz World о международных рынках и деловых возможностях. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума.'),
('businessherald.ru','Business Herald о репутации компаний и деловых партнёрствах','Business Herald о репутации компаний и деловых партнёрствах. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума.'),
('business-arena.ru','Business Arena о конкуренции, переговорах и сделках','Business Arena о конкуренции, переговорах и сделках. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для бизнеса.'),
('business-focus.ru','Business Focus о проверке гипотез и фокусе собственника','Business Focus о проверке гипотез и фокусе собственника. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума.'),
]
# Correct a typo in the literal above before comparison.
SITES[5]=(SITES[5][0],SITES[5][1],'Bizupdate об изменениях компаний, продуктов и рынков. Бизнес, люди, сервисы и рынки. Факты, понятный контекст и выводы без рекламного шума. Для бизнеса.')

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.intitle=False;self.title=[];self.inh1=False;self.h1=[];self.h1s=[];self.meta={};self.canonical=None;self.lang=None;self.script=False;self.buf=[];self.types=[]
    def handle_starttag(self,tag,attrs):
        d={k.lower():(v or '') for k,v in attrs};tag=tag.lower()
        if tag=='html':self.lang=d.get('lang')
        elif tag=='title':self.intitle=True
        elif tag=='h1':self.inh1=True;self.h1=[]
        elif tag=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k:self.meta[k]=d.get('content','').strip()
        elif tag=='link' and 'canonical' in d.get('rel','').lower().split():self.canonical=d.get('href','').strip()
        elif tag=='script' and (d.get('type') or '').lower()=='application/ld+json':self.script=True;self.buf=[]
    def handle_endtag(self,tag):
        tag=tag.lower()
        if tag=='title':self.intitle=False
        elif tag=='h1':
            self.inh1=False;v=' '.join(''.join(self.h1).split());
            if v:self.h1s.append(v)
        elif tag=='script' and self.script:
            raw=''.join(self.buf)
            try:
                obj=json.loads(raw);stack=[obj]
                while stack:
                    x=stack.pop()
                    if isinstance(x,dict):
                        t=x.get('@type');
                        if isinstance(t,str):self.types.append(t)
                        elif isinstance(t,list):self.types.extend(map(str,t))
                        stack.extend(x.values())
                    elif isinstance(x,list):stack.extend(x)
            except Exception:pass
            self.script=False;self.buf=[]
    def handle_data(self,d):
        if self.intitle:self.title.append(d)
        if self.inh1:self.h1.append(d)
        if self.script:self.buf.append(d)
    def result(self):return {'title':' '.join(''.join(self.title).split()),'description':self.meta.get('description'),'robots':self.meta.get('robots'),'canonical':self.canonical,'lang':self.lang,'h1s':self.h1s,'jsonld_types':sorted(set(self.types))}

def req(url,timeout=25):
    r=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*','Cache-Control':'no-cache'})
    t=time.time()
    try:
        with urllib.request.urlopen(r,timeout=timeout,context=ssl.create_default_context()) as x:return {'status':x.status,'url':x.geturl(),'headers':dict(x.headers),'body':x.read(3000000).decode('utf-8','replace'),'ms':round((time.time()-t)*1000)}
    except urllib.error.HTTPError as e:return {'status':e.code,'url':getattr(e,'url',url),'headers':dict(e.headers or {}),'body':e.read(1000000).decode('utf-8','replace'),'error':f'HTTP {e.code}','ms':round((time.time()-t)*1000)}
    except Exception as e:return {'status':None,'url':url,'error':type(e).__name__+': '+str(e)[:200],'ms':round((time.time()-t)*1000)}

def html(url):
    r=req(url);p=P();
    try:p.feed(r.get('body',''))
    except Exception:pass
    z=p.result();z.update({k:r.get(k) for k in ('status','url','ms','error') if r.get(k) is not None});return z

def host(u):
    try:return (urllib.parse.urlsplit(u).hostname or '').lower().removeprefix('www.')
    except Exception:return ''

def noindex(v):return 'noindex' in (v or '').lower()

def audit(site):
    d,et,ed=site;base='https://'+d
    out={'domain':d,'expected':{'title':et,'description':ed},'checks':{},'warnings':[]}
    variants=[]
    for u in [f'http://{d}/',f'https://{d}/',f'http://www.{d}/',f'https://www.{d}/']:
        r=req(u,15);variants.append({'input':u,'status':r.get('status'),'final':r.get('url'),'error':r.get('error')})
    out['variants']=variants
    out['checks']['preferred_host']=all(x.get('status')==200 and x.get('final','').startswith(f'https://{d}') for x in variants)
    home=html(base+'/');out['homepage']=home
    out['checks']['home_200']=home.get('status')==200
    out['checks']['title_exact']=home.get('title')==et
    out['checks']['description_exact']=home.get('description')==ed
    out['checks']['canonical_self']=host(home.get('canonical',''))==d
    out['checks']['indexable']=not noindex(home.get('robots'))
    if len(home.get('h1s',[]))!=1:out['warnings'].append({'h1_count':len(home.get('h1s',[])),'h1s':home.get('h1s',[])[:5]})
    rr=req(base+'/robots.txt');body=rr.get('body','');sitemaps=re.findall(r'(?im)^\s*Sitemap:\s*(\S+)',body)
    out['robots']={'status':rr.get('status'),'sitemaps':sitemaps,'disallow_root':bool(re.search(r'(?im)^\s*Disallow:\s*/\s*$',body))}
    foreign=[u for u in sitemaps if host(u)!=d]
    out['checks']['robots_ok']=rr.get('status')==200 and not out['robots']['disallow_root']
    out['checks']['robots_no_foreign_sitemap']=not foreign
    out['checks']['robots_own_sitemap']=any(host(u)==d for u in sitemaps)
    sm=req(base+'/sitemap_index.xml');locs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',sm.get('body',''),re.I)
    out['sitemap']={'status':sm.get('status'),'children':locs[:50],'foreign_children':[u for u in locs if host(u)!=d]}
    out['checks']['sitemap_ok']=sm.get('status')==200 and bool(locs) and not out['sitemap']['foreign_children']
    child=[]
    for u in locs[:4]:
        c=req(u);urls=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',c.get('body',''),re.I)
        child.append({'url':u,'status':c.get('status'),'url_count':len(urls),'foreign_urls':[x for x in urls if host(x)!=d][:10]})
    out['sitemap']['sample_children']=child
    out['checks']['child_sitemaps_ok']=all(x['status']==200 and not x['foreign_urls'] for x in child) if child else False
    wr=req(base+'/wp-json/');root=None
    try:root=json.loads(wr.get('body',''))
    except Exception:pass
    out['wp']={'status':wr.get('status'),'rankmath':isinstance(root,dict) and any(str(x).startswith('rankmath/') for x in root.get('namespaces',[]))}
    out['checks']['wp_rest_ok']=out['wp']['status']==200 and out['wp']['rankmath']
    pr=req(base+'/wp-json/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=link,status,date,modified')
    posts=None
    try:posts=json.loads(pr.get('body',''))
    except Exception:pass
    if isinstance(posts,list) and posts:
        out['sample_post_ref']=posts[0];u=posts[0].get('link');ph=html(u) if u else {};out['sample_post']=ph
        out['checks']['sample_post_ok']=ph.get('status')==200 and not noindex(ph.get('robots')) and host(ph.get('canonical',''))==d and bool(ph.get('title'))
    else:out['checks']['sample_post_ok']=False
    out['pass']=all(out['checks'].values())
    return out

def main():
    report={'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sites':[]}
    with ThreadPoolExecutor(max_workers=5) as ex:
        fut={ex.submit(audit,s):s[0] for s in SITES}
        for f in as_completed(fut):
            try:report['sites'].append(f.result())
            except Exception as e:report['sites'].append({'domain':fut[f],'pass':False,'fatal':type(e).__name__+': '+str(e)[:300]})
    report['sites'].sort(key=lambda x:[s[0] for s in SITES].index(x['domain']))
    report['passed']=sum(bool(x.get('pass')) for x in report['sites']);report['total']=len(report['sites']);report['all_pass']=report['passed']==report['total'];report['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(report,open('seo-final-report.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'all_pass':report['all_pass'],'passed':report['passed'],'total':report['total']}))
    raise SystemExit(0 if report['all_pass'] else 3)
if __name__=='__main__':main()
