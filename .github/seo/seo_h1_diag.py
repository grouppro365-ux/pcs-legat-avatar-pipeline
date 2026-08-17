#!/usr/bin/env python3
import json, re, ssl, time, urllib.request, urllib.error
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed

SITES = ['ampliv.ru', 'businessbrief.ru', 'topentrepreneur.ru']

class H1Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[]; self.h1s=[]; self.current=None
    def handle_starttag(self, tag, attrs):
        d={k:(v or '') for k,v in attrs}
        node={'tag':tag.lower(),'id':d.get('id',''),'class':d.get('class',''),'role':d.get('role','')}
        self.stack.append(node)
        if tag.lower()=='h1':
            self.current={'attrs':node.copy(),'ancestors':[x.copy() for x in self.stack[-6:-1]],'text':[]}
    def handle_data(self,data):
        if self.current is not None:self.current['text'].append(data)
    def handle_endtag(self,tag):
        tag=tag.lower()
        if tag=='h1' and self.current is not None:
            self.current['text']=' '.join(''.join(self.current['text']).split())
            self.h1s.append(self.current);self.current=None
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i]['tag']==tag:
                self.stack=self.stack[:i]
                break

def fetch(domain):
    url='https://'+domain+'/'
    q=urllib.request.Request(url,headers={'User-Agent':'SEOH1Diagnostics/1.1','Cache-Control':'no-cache'})
    try:
        with urllib.request.urlopen(q,timeout=30,context=ssl.create_default_context()) as r:
            body=r.read(4_000_000).decode('utf-8','replace');status=r.status;headers=dict(r.headers)
    except urllib.error.HTTPError as e:
        body=e.read(1_000_000).decode('utf-8','replace');status=e.code;headers=dict(e.headers or {})
    p=H1Parser()
    try:p.feed(body)
    except Exception:pass
    raw=[]
    for m in re.finditer(r'<h1\b[^>]*>.*?</h1\s*>',body,re.I|re.S):
        frag=re.sub(r'\s+',' ',m.group(0)).strip();raw.append(frag[:1200])
    return {'domain':domain,'status':status,'h1_count':len(p.h1s),'h1s':p.h1s,'raw_h1_fragments':raw,'cache_headers':{k:v for k,v in headers.items() if k.lower() in ('server','cache-control','x-cache','x-cache-status')}}

def main():
    out={'mode':'remaining_h1_structure_diag','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sites':[]}
    with ThreadPoolExecutor(max_workers=3) as ex:
        fut={ex.submit(fetch,d):d for d in SITES}
        for f in as_completed(fut):
            try:out['sites'].append(f.result())
            except Exception as e:out['sites'].append({'domain':fut[f],'fatal':type(e).__name__+': '+str(e)})
    out['sites'].sort(key=lambda x:SITES.index(x['domain']))
    out['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(out,open('seo-h1-diag.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps([{'domain':x['domain'],'h1_count':x.get('h1_count'),'texts':[h.get('text') for h in x.get('h1s',[])]} for x in out['sites']],ensure_ascii=False))
if __name__=='__main__':main()
