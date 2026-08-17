#!/usr/bin/env python3
import urllib.request, urllib.error, hashlib, csv, io, json
URL='https://docs.google.com/spreadsheets/d/19CyUeI02frZr0uMOSLBPSSlihQp9TuSgngBzeDkVCLU/export?format=csv&gid=1405450300'
req=urllib.request.Request(URL,headers={'User-Agent':'WPKeySheetAccessProbe/1.0'})
out={}
try:
    with urllib.request.urlopen(req,timeout=20) as r:
        data=r.read(5_000_000)
        text=data.decode('utf-8-sig','replace')
        rows=list(csv.reader(io.StringIO(text)))
        out={'status':r.status,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'rows':len(rows),'header':rows[0] if rows else [],'looks_like_key_sheet':bool(rows and 'Application Password / API ключ' in rows[0])}
except urllib.error.HTTPError as e:
    out={'status':e.code,'error':'HTTP '+str(e.code)}
except Exception as e:
    out={'status':None,'error':type(e).__name__+': '+str(e)[:180]}
print(json.dumps(out,ensure_ascii=False))
