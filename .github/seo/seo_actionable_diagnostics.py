#!/usr/bin/env python3
import json,re,ssl,time,urllib.request,urllib.error,urllib.parse
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor,as_completed

ROOT='.seo-runner/fleet-completion.json'
UA='SEOActionableDiagnostics/1.0'

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.meta={};self.canonical=None;self.title=[];self.it=False
    def handle_starttag(self,t,a):
        d={k.lower():(v or '') for k,v in a};t=t.lower()
        if t=='title':self.it=True
        elif t=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k:self.meta[k]=d.get('content','').strip()
        elif t=='link' and 'canonical' in d.get('rel','').lower().split():self.canonical=d.get('href','').strip()
    def handle_endtag(self,t):
        if t.lower()=='title':self.it=False
    def handle_data(self,d):
        if self.it:self.title.append(d)

def req(url,timeout=20):
    q=urllib.request.Request(url,headers={'User-Agent':UA,'Cache-Control':'no-cache','Accept':'*/*'})
    try:
        with urllib.request.urlopen(q,timeout=timeout,context=ssl.create_default_context()) as r:return {'status':r.status,'final':r.geturl(),'headers':dict(r.headers),'body':r.read(2500000).decode('utf-8','replace')}
    except urllib.error.HTTPError as e:return {'status':e.code,'final':getattr(e,'url',url),'headers':dict(e.headers or {}),'body':e.read(800000).decode('utf-8','replace'),'error':f'HTTP {e.code}'}
    except Exception as e:return {'status':None,'final':url,'error':type(e).__name__+': '+str(e)[:180],'body':''}

def host(u):
    try:return (urllib.parse.urlsplit(u).hostname or '').lower().removeprefix('www.')
    except:return ''

def robots(domain):
    x=req('https://'+domain+'/robots.txt');b=x.get('body','');maps=re.findall(r'(?im)^\s*Sitemap:\s*(\S+)',b);root=bool(re.search(r'(?im)^\s*Disallow:\s*/\s*$',b));
    if x.get('status')!=200:kind='non200_or_unreachable'
    elif root:kind='disallow_root'
    elif not maps:kind='missing_sitemap_line'
    elif not any(host(u)==domain for u in maps):kind='foreign_or_wrong_sitemap'
    else:kind='other'
    return {'domain':domain,'kind':kind,'status':x.get('status'),'sitemaps':maps,'disallow_root':root,'body_prefix':b[:1200],'error':x.get('error')}

def httpsdiag(domain):
    h=req('http://'+domain+'/',15);s=req('https://'+domain+'/',15)
    return {'domain':domain,'http_status':h.get('status'),'http_final':h.get('final'),'https_status':s.get('status'),'https_final':s.get('final'),'http_error':h.get('error'),'https_error':s.get('error')}

def postdiag(domain):
    x=req('https://'+domain+'/wp-json/wp/v2/posts?per_page=1&orderby=date&order=desc&_fields=id,link,status,date,modified,title',20)
    posts=None
    try:posts=json.loads(x.get('body',''))
    except:posts=None
    out={'domain':domain,'rest_status':x.get('status'),'posts_type':type(posts).__name__,'posts_count':len(posts) if isinstance(posts,list) else None,'rest_error':x.get('error')}
    if isinstance(posts,list) and posts:
        p=posts[0];out['post_ref']=p;h=req(p.get('link',''),20);parser=P();
        try:parser.feed(h.get('body',''))
        except:pass
        out['page']={'status':h.get('status'),'final':h.get('final'),'title':' '.join(''.join(parser.title).split()),'robots':parser.meta.get('robots'),'canonical':parser.canonical}
    return out

def capitrx():
    d='capitrx.ru';home=req('https://'+d+'/');p=P();
    try:p.feed(home.get('body',''))
    except:pass
    w=req('https://'+d+'/wp-json/');root=None
    try:root=json.loads(w.get('body',''))
    except:pass
    return {'domain':d,'home_status':home.get('status'),'title':' '.join(''.join(p.title).split()),'description':p.meta.get('description'),'canonical':p.canonical,'robots':p.meta.get('robots'),'wp_status':w.get('status'),'namespaces':root.get('namespaces',[]) if isinstance(root,dict) else [],'wp_error':w.get('error')}

def main():
    data=json.load(open(ROOT,encoding='utf-8'));b=data['issue_buckets']
    rob=b.get('robots_ok',[]);http=b.get('https_preferred',[]);posts=b.get('sample_post_ok',[])
    out={'mode':'actionable_repair_diagnostics','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    for key,fn,domains in [('robots',robots,rob),('https',httpsdiag,http),('sample_posts',postdiag,posts)]:
        vals=[]
        with ThreadPoolExecutor(max_workers=14) as ex:
            fut={ex.submit(fn,d):d for d in domains}
            for f in as_completed(fut):
                try:vals.append(f.result())
                except Exception as e:vals.append({'domain':fut[f],'fatal':type(e).__name__+': '+str(e)[:180]})
        vals.sort(key=lambda x:domains.index(x['domain']));out[key]=vals
    out['capitrx']=capitrx()
    kinds={}
    for x in out['robots']:kinds[x.get('kind','fatal')]=kinds.get(x.get('kind','fatal'),0)+1
    out['summary']={'robots_kinds':kinds,'https_live_nonredirect':[x['domain'] for x in out['https'] if x.get('http_status') is not None and x.get('https_status')==200 and not str(x.get('http_final','')).startswith('https://')],'sample_post_live_failures':[x['domain'] for x in out['sample_posts'] if x.get('rest_status')==200]}
    out['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(out,open('seo-actionable-diagnostics.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps(out['summary'],ensure_ascii=False))
if __name__=='__main__':main()
