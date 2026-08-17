#!/usr/bin/env python3
import json,re,ssl,urllib.request,urllib.parse,time

BASE='https://ai-media-dispatcher.grouppro365.chatgpt.site'
UA='DispatcherRouteDiscovery/1.0'

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    try:
        with urllib.request.urlopen(req,timeout=20,context=ssl.create_default_context()) as r:
            b=r.read(8_000_000).decode('utf-8','replace')
            return {'status':r.status,'url':r.geturl(),'content_type':r.headers.get('content-type'),'body':b}
    except Exception as e:
        return {'status':None,'url':url,'error':type(e).__name__+': '+str(e)[:250],'body':''}

def clean(s):
    return s.replace('\\/','/').replace('\\u002F','/')

def main():
    home=get(BASE+'/')
    html=home.get('body','')
    scripts=[]
    for src in re.findall(r'<script[^>]+src=["\']([^"\']+)',html,re.I):
        u=urllib.parse.urljoin(BASE+'/',src)
        if u not in scripts: scripts.append(u)
    assets=[]; alltext=html
    for u in scripts[:60]:
        x=get(u); body=x.get('body','')
        assets.append({'url':u,'status':x.get('status'),'content_type':x.get('content_type'),'bytes':len(body)})
        if body: alltext+='\n'+body
    text=clean(alltext)
    route_patterns=[
        r'["\'](/api/[A-Za-z0-9_?&=./:{}\-\[\]]+)["\']',
        r'["\'](/trpc/[A-Za-z0-9_?&=./:{}\-\[\]]+)["\']',
        r'["\'](/rpc/[A-Za-z0-9_?&=./:{}\-\[\]]+)["\']',
    ]
    routes=set()
    for pat in route_patterns:
        for m in re.findall(pat,text): routes.add(m)
    keywords=['wordpress','rank math','rankmath','bridge','wp-sites','wp_sites','platforms','connections','integrations','site-registry','release-gate']
    snippets=[]
    low=text.lower()
    for kw in keywords:
        pos=0; n=0
        while n<12:
            i=low.find(kw,pos)
            if i<0: break
            s=max(0,i-220); e=min(len(text),i+420)
            snippet=re.sub(r'\s+',' ',text[s:e])
            snippets.append({'keyword':kw,'snippet':snippet[:900]})
            pos=i+len(kw); n+=1
    selected=sorted(r for r in routes if any(k in r.lower() for k in ['wordpress','wp','rank','seo','platform','connection','integration','release','site']))
    probes=[]
    for r in selected[:80]:
        # Only probe literal GET-safe routes without template params/query placeholders.
        if any(c in r for c in ['{','}','[',']',':']) or '?' in r: continue
        x=get(urllib.parse.urljoin(BASE,r))
        body=x.get('body','')
        probes.append({'route':r,'status':x.get('status'),'content_type':x.get('content_type'),'body_prefix':re.sub(r'\s+',' ',body[:600])})
    out={'mode':'dispatcher_api_discovery','base':BASE,'home_status':home.get('status'),'scripts':assets,'all_routes':sorted(routes),'selected_routes':selected,'probes':probes,'snippets':snippets,'finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    json.dump(out,open('dispatcher-api-discovery.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'home':out['home_status'],'scripts':len(assets),'routes':len(routes),'selected':selected[:50],'probes':[(p['route'],p['status']) for p in probes]},ensure_ascii=False))

if __name__=='__main__': main()
