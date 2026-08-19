#!/usr/bin/env python3
import importlib.util, json, os, subprocess

BASE='.github/seo/seo_fleet_beget_repair.py'
spec=importlib.util.spec_from_file_location('fleet',BASE)
fleet=importlib.util.module_from_spec(spec); spec.loader.exec_module(fleet)

CANDIDATES=[
  'legat-herald.ru/public_html','legatherald.ru/public_html','legatherald.online/public_html',
  'legat-herald.ru','legatherald.ru','legatherald.online'
]

def run(cmd):
    p=subprocess.run(cmd,capture_output=True,text=True)
    return p.returncode,p.stdout,(p.stderr or '').strip()[:500]

def list_dir(path):
    rc,out,err=run(['curl','--silent','--show-error','--fail','--ssl-reqd','--user',f'{fleet.BEGET_USER}:{fleet.BEGET_PASSWORD}','--list-only',f'ftp://{fleet.FTP_HOST}/{path.strip("/")}/'])
    return out.splitlines() if rc==0 else []

def cleanup_probe_files():
    results=[]
    for parent in CANDIDATES:
        names=[x.strip() for x in list_dir(parent) if x.strip().startswith('.seo-root-probe-')]
        for name in names:
            rc,out,err=run(['curl','--silent','--show-error','--ssl-reqd','--user',f'{fleet.BEGET_USER}:{fleet.BEGET_PASSWORD}',
                            '--quote',f'CWD {parent}','--quote',f'DELE {name}',f'ftp://{fleet.FTP_HOST}/'])
            results.append({'path':parent+'/'+name,'deleted':rc==0,'error':err or None})
    return results

def main():
    site={'domain':'legat-herald.ru','ftp_wp_path':'legatherald.online/public_html','fix_tag':True,'fix_robots':True,'fix_https':False,'h1_mode':None}
    result=fleet.repair_one(site)
    result['probe_cleanup']=cleanup_probe_files()
    result['probe_cleanup_remaining']=sum(1 for p in CANDIDATES for x in list_dir(p) if x.strip().startswith('.seo-root-probe-'))
    result['pass']=bool(result.get('invoke_status')==200 and result.get('verification',{}).get('pass') and result.get('installer_after_status')==404 and result['probe_cleanup_remaining']==0)
    json.dump(result,open('seo-legat-herald-fix.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'pass':result['pass'],'invoke':result.get('invoke_status'),'cleanup_remaining':result['probe_cleanup_remaining']}))
    raise SystemExit(0 if result['pass'] else 3)

if __name__=='__main__': main()
