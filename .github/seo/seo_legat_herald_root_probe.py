#!/usr/bin/env python3
import json, os, subprocess, tempfile, time, urllib.request, urllib.error, ssl, secrets

HOST=os.getenv('BEGET_FTP_HOST','legatbb9.beget.tech')
USER=os.getenv('BEGET_USER','')
PASSWORD=os.getenv('BEGET_PASSWORD','')
DOMAIN='legat-herald.ru'
CANDIDATES=[
  'legat-herald.ru/public_html',
  'legatherald.ru/public_html',
  'legatherald.online/public_html',
  'legat-herald.ru',
  'legatherald.ru',
  'legatherald.online',
]

def run(cmd):
    p=subprocess.run(cmd,capture_output=True,text=True)
    return p.returncode,p.stdout,(p.stderr or '').strip()[:500]

def ftp_list(path):
    rc,out,err=run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','12','--max-time','30','--user',f'{USER}:{PASSWORD}','--list-only',f'ftp://{HOST}/{path.strip("/")}/'])
    return (out.splitlines() if rc==0 else None),err

def upload(path,body):
    with tempfile.NamedTemporaryFile('w',delete=False,encoding='utf-8') as f:
        f.write(body); local=f.name
    try:
        rc,out,err=run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','12','--max-time','30','--user',f'{USER}:{PASSWORD}','--upload-file',local,f'ftp://{HOST}/{path.lstrip("/")}'])
        return rc==0,err
    finally:
        try: os.unlink(local)
        except: pass

def delete(path):
    parent,name=path.rsplit('/',1)
    rc,out,err=run(['curl','--silent','--show-error','--ssl-reqd','--connect-timeout','12','--max-time','30','--user',f'{USER}:{PASSWORD}','--quote',f'DELE {name}',f'ftp://{HOST}/{parent.strip("/")}/'])
    return rc==0,err

def http_get(url):
    q=urllib.request.Request(url,headers={'User-Agent':'SEORootProbe/1.0','Cache-Control':'no-cache'})
    try:
        with urllib.request.urlopen(q,timeout=25,context=ssl.create_default_context()) as r:
            return r.status,r.read(10000).decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code,e.read(10000).decode('utf-8','replace')
    except Exception as e:
        return None,type(e).__name__+': '+str(e)[:200]

def main():
    if not USER or not PASSWORD:
        raise SystemExit('missing credentials')
    token=secrets.token_hex(12)
    fname=f'.seo-root-probe-{token}.txt'
    out={'domain':DOMAIN,'candidates':[],'live_root':None}
    uploaded=[]
    for i,c in enumerate(CANDIDATES):
        listing,err=ftp_list(c)
        item={'candidate':c,'exists':listing is not None,'wp_like':bool(listing and ('wp-load.php' in listing or 'wp-config.php' in listing)),'upload_ok':False}
        if listing is not None:
            marker=f'{token}|{i}|{c}'
            ok,uerr=upload(c+'/'+fname,marker)
            item['upload_ok']=ok; item['upload_error']=uerr or None
            if ok: uploaded.append((c+'/'+fname,marker,c))
        out['candidates'].append(item)
    time.sleep(1)
    st,body=http_get(f'https://{DOMAIN}/{fname}?v={int(time.time())}')
    out['http_probe']={'status':st,'body_prefix':body[:200]}
    for path,marker,c in uploaded:
        if body.strip()==marker:
            out['live_root']=c
        ok,derr=delete(path)
        for item in out['candidates']:
            if item['candidate']==c:
                item['cleanup_ok']=ok; item['cleanup_error']=derr or None
    json.dump(out,open('seo-legat-herald-root-probe.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'live_root':out['live_root'],'http_status':st,'uploaded':len(uploaded)}))
    raise SystemExit(0 if out['live_root'] else 3)

if __name__=='__main__': main()
