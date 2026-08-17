#!/usr/bin/env python3
import json,re,ssl,time,urllib.request,urllib.error,urllib.parse
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor,as_completed
SITES=['ambitix.ru','aspirix.ru','biz-focus.ru','bizcenter-news.ru','biz-report.ru','bizupdate.ru','biz-world.ru','businessherald.ru','business-arena.ru','business-focus.ru']
UA='SEOTagArchiveAudit/1.0'
class P(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.t=False;self.title=[];self.meta={};self.canonical=None;self.article_links=set()
 def handle_starttag(self,tag,attrs):
  d={k.lower():(v or '') for k,v in attrs};tag=tag.lower()
  if tag=='title':self.t=True
  elif tag=='meta':
   k=(d.get('name') or d.get('property') or '').lower()
   if k:self.meta[k]=d.get('content','').strip()
  elif tag=='link' and 'canonical' in d.get('rel','').lower().split():self.canonical=d.get('href','').strip()
  elif tag=='a':
   h=d.get('href','')
   if h and '/tag/' not in h and not any(x in h for x in ['/category/','/wp-','/contact','/privacy','/sotrudnichestvo','/#']):self.article_links.add(h)
 def handle_endtag(self,tag):
  if tag.lower()=='title':self.t=False
 def handle_data(self,d):
  if self.t:self.title.append(d)
def req(url):
 q=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*','Cache-Control':'no-cache'})
 try:
  with urllib.request.urlopen(q,timeout=25,context=ssl.create_default_context()) as r:return r.status,r.geturl(),dict(r.headers),r.read(3_000_000).decode('utf-8','replace')
 except urllib.error.HTTPError as e:return e.code,getattr(e,'url',url),dict(e.headers or {}),e.read(1_000_000).decode('utf-8','replace')
 except Exception as e:return None,url,{},type(e).__name__+': '+str(e)[:200]
def host(u):
 try:return (urllib.parse.urlsplit(u).hostname or '').lower().removeprefix('www.')
 except:return ''
def audit(d):
 base='https://'+d; st,u,h,b=req(base+'/sitemap_index.xml'); children=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',b,re.I); tags=[x for x in children if 'post_tag-sitemap' in x]
 tag_urls=[]; sitemap_details=[]
 for sm in tags:
  sst,su,sh,sb=req(sm); locs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',sb,re.I);tag_urls.extend(locs);sitemap_details.append({'url':sm,'status':sst,'count':len(locs)})
 # REST total is useful even when sitemap disabled later
 rst,ru,rh,rb=req(base+'/wp-json/wp/v2/tags?per_page=1&_fields=id,link,count')
 total=None
 for k,v in rh.items():
  if k.lower()=='x-wp-total':
   try:total=int(v)
   except:pass
 samples=[]
 for x in tag_urls[:5]:
  pst,pu,ph,pb=req(x);p=P();
  try:p.feed(pb)
  except:pass
  robots=p.meta.get('robots',''); samples.append({'url':x,'status':pst,'title':' '.join(''.join(p.title).split()),'robots':robots,'canonical':p.canonical,'indexable':'noindex' not in robots.lower(),'same_canonical':host(p.canonical or '')==d,'approx_internal_content_links':len([z for z in p.article_links if host(z)==d])})
 return {'domain':d,'sitemap_status':st,'tag_sitemap_count':len(tags),'tag_urls_in_sitemaps':len(tag_urls),'wp_tag_total':total,'tag_sitemaps':sitemap_details,'samples':samples}
def main():
 out={'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sites':[]}
 with ThreadPoolExecutor(max_workers=5) as ex:
  fs={ex.submit(audit,d):d for d in SITES}
  for f in as_completed(fs):
   try:out['sites'].append(f.result())
   except Exception as e:out['sites'].append({'domain':fs[f],'fatal':type(e).__name__+': '+str(e)})
 out['sites'].sort(key=lambda x:SITES.index(x['domain']));out['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 json.dump(out,open('seo-tag-audit.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
 print(json.dumps([{'domain':x['domain'],'tag_sitemaps':x.get('tag_sitemap_count'),'tag_urls':x.get('tag_urls_in_sitemaps'),'wp_tags':x.get('wp_tag_total')} for x in out['sites']]))
if __name__=='__main__':main()
