#!/usr/bin/env python3
import hashlib,json,os,subprocess,tempfile,time,urllib.request,urllib.error,ssl
from html.parser import HTMLParser

class P(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True); self.t=False; self.title=[]; self.meta={}; self.canonical=None
    def handle_starttag(self,tag,attrs):
        d={k.lower():(v or '') for k,v in attrs}; tag=tag.lower()
        if tag=='title': self.t=True
        elif tag=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k:self.meta[k]=d.get('content','').strip()
        elif tag=='link' and 'canonical' in d.get('rel','').lower().split(): self.canonical=d.get('href','').strip()
    def handle_endtag(self,tag):
        if tag.lower()=='title': self.t=False
    def handle_data(self,d):
        if self.t:self.title.append(d)

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'SEORepairCachePurge/1.0','Cache-Control':'no-cache','Pragma':'no-cache'})
    try:
        with urllib.request.urlopen(req,timeout=30,context=ssl.create_default_context()) as r:
            b=r.read(2_000_000).decode('utf-8','replace'); h=dict(r.headers); st=r.status
    except urllib.error.HTTPError as e: b=e.read().decode('utf-8','replace'); h=dict(e.headers or {}); st=e.code
    except Exception as e: return {'status':None,'error':type(e).__name__+': '+str(e)[:250]}
    p=P();
    try:p.feed(b)
    except Exception:pass
    return {'status':st,'title':' '.join(''.join(p.title).split()),'description':p.meta.get('description'),'robots':p.meta.get('robots'),'canonical':p.canonical,
            'cache_headers':{k:v for k,v in h.items() if k.lower() in ('x-cache','x-cache-status','x-litespeed-cache','cf-cache-status','age','x-proxy-cache','server','cache-control')}}

def upload(host,user,pw,remote,local):
    cmd=['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','15','--max-time','45','--user',f'{user}:{pw}','--upload-file',local,f"ftp://{host}/{remote.lstrip('/')}"]
    p=subprocess.run(cmd,capture_output=True,text=True); return p.returncode==0,(p.stderr or '').strip()[:400]

def php(site,token):
    cfg={'domain':site['domain'],'token':token}
    enc=__import__('base64').b64encode(json.dumps(cfg).encode()).decode()
    return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+enc+"'"+r'''),true);
$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN'] ?? '';
if(!$got || !hash_equals($cfg['token'],$got)){http_response_code(403);echo json_encode(['ok'=>false]);exit;}
define('WP_USE_THEMES',false); require_once __DIR__.'/wp-load.php';
$actual=parse_url(home_url('/'),PHP_URL_HOST);
if(strtolower((string)$actual)!==strtolower($cfg['domain'])){http_response_code(409);echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual]);@unlink(__FILE__);exit;}
$plugins=(array)get_option('active_plugins',[]); $actions=[];
if(function_exists('wp_cache_flush')){$actions['wp_cache_flush']=wp_cache_flush();}
if(function_exists('rocket_clean_domain')){rocket_clean_domain();$actions['wp_rocket']=true;}
if(function_exists('wp_cache_clear_cache')){wp_cache_clear_cache();$actions['wp_super_cache']=true;}
if(function_exists('w3tc_flush_all')){w3tc_flush_all();$actions['w3tc']=true;}
if(class_exists('WpFastestCache')){try{$c=new WpFastestCache();if(method_exists($c,'deleteCache')){$c->deleteCache(true);$actions['wp_fastest_cache']=true;}}catch(Throwable $e){$actions['wp_fastest_cache_error']=$e->getMessage();}}
if(class_exists('autoptimizeCache')){try{autoptimizeCache::clearall();$actions['autoptimize']=true;}catch(Throwable $e){}}
if(class_exists('Breeze_PurgeCache')){try{Breeze_PurgeCache::breeze_cache_flush();$actions['breeze']=true;}catch(Throwable $e){}}
do_action('litespeed_purge_all'); $actions['litespeed_action']=true;
do_action('sg_cachepress_purge_cache'); $actions['sg_action']=true;
// Clear only generated page-cache subtrees. Do not touch uploads or plugin code.
$cache=WP_CONTENT_DIR.'/cache'; $removed=[];
$targets=['all','supercache','wp-rocket','wpo-cache','cache-enabler','page_enhanced'];
$rr=function($path) use (&$rr,&$removed){if(!is_dir($path))return;foreach(scandir($path) as $x){if($x==='.'||$x==='..')continue;$p=$path.'/'.$x;if(is_dir($p)){$rr($p);@rmdir($p);}else{@unlink($p);}}@rmdir($path);};
foreach($targets as $t){$p=$cache.'/'.$t;if(is_dir($p)){$rr($p);$removed[]=$t;}}
$deleted=@unlink(__FILE__);
echo json_encode(['ok'=>true,'domain'=>$cfg['domain'],'plugins'=>$plugins,'actions'=>$actions,'removed_cache_subtrees'=>$removed,'self_deleted'=>$deleted],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''

def invoke(url,token):
    req=urllib.request.Request(url,headers={'X-SEO-Repair-Token':token,'User-Agent':'SEORepairCachePurge/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=45,context=ssl.create_default_context()) as r:return r.status,r.read().decode('utf-8','replace')
    except urllib.error.HTTPError as e:return e.code,e.read().decode('utf-8','replace')
    except Exception as e:return None,str(e)

def main():
    cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8')); b=cfg['beget']; host=cfg['ftp_host']; out={'mode':'cache_purge','sites':[]}
    for s in cfg['sites']:
        token=hashlib.sha256(os.urandom(32)).hexdigest(); name='.seo-cache-'+hashlib.sha256((s['domain']+token).encode()).hexdigest()[:18]+'.php'; code=php(s,token)
        with tempfile.NamedTemporaryFile('w',delete=False,suffix='.php',encoding='utf-8') as f:f.write(code); local=f.name
        ok,err=upload(host,b['user'],b['password'],s['ftp_wp_path'].rstrip('/')+'/'+name,local);os.unlink(local)
        item={'domain':s['domain'],'before':get('https://'+s['domain']+'/'),'upload_ok':ok,'upload_error':err or None}
        if ok:
            st,body=invoke('https://'+s['domain']+'/'+name,token); item['invoke_status']=st
            try:item['purge']=json.loads(body)
            except Exception:item['purge']={'raw':body[:500]}
            time.sleep(1); item['after']=get('https://'+s['domain']+'/?_seo_purge='+str(int(time.time()))); item['root_after']=get('https://'+s['domain']+'/')
        out['sites'].append(item)
    json.dump(out,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'ok':True,'sites':len(out['sites'])}))
if __name__=='__main__':main()
