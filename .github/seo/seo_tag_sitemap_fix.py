#!/usr/bin/env python3
import base64,hashlib,json,os,subprocess,tempfile,time,urllib.request,urllib.error,ssl,re

def upload(host,user,pw,remote,local):
 p=subprocess.run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','15','--max-time','45','--user',f'{user}:{pw}','--upload-file',local,f"ftp://{host}/{remote.lstrip('/')}"],capture_output=True,text=True);return p.returncode==0,(p.stderr or '').strip()[:400]
def req(url,headers=None):
 q=urllib.request.Request(url,headers={'User-Agent':'SEOTagSitemapFix/1.0','Cache-Control':'no-cache',**(headers or {})})
 try:
  with urllib.request.urlopen(q,timeout=45,context=ssl.create_default_context()) as r:return r.status,r.geturl(),r.read(3000000).decode('utf-8','replace')
 except urllib.error.HTTPError as e:return e.code,getattr(e,'url',url),e.read(1000000).decode('utf-8','replace')
 except Exception as e:return None,url,type(e).__name__+': '+str(e)[:300]
def php(domain,token):
 enc=base64.b64encode(json.dumps({'domain':domain,'token':token}).encode()).decode()
 return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+enc+"'"+r'''),true);$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN']??'';
if(!$got||!hash_equals($cfg['token'],$got)){http_response_code(403);echo json_encode(['ok'=>false]);exit;}
define('WP_USE_THEMES',false);require_once __DIR__.'/wp-load.php';
$actual=parse_url(home_url('/'),PHP_URL_HOST);if(strtolower((string)$actual)!==strtolower($cfg['domain'])){http_response_code(409);echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual]);@unlink(__FILE__);exit;}
$name='rank-math-options-sitemap';$opt=get_option($name,[]);if(!is_array($opt))$opt=[];$before=$opt['tax_post_tag_sitemap']??null;$opt['tax_post_tag_sitemap']='off';$updated=update_option($name,$opt,false);wp_cache_delete($name,'options');
if(function_exists('wp_cache_flush'))wp_cache_flush();do_action('rank_math/sitemap/flush_cache');if(function_exists('w3tc_flush_all'))w3tc_flush_all();
$after=get_option($name,[])['tax_post_tag_sitemap']??null;$deleted=@unlink(__FILE__);
echo json_encode(['ok'=>true,'domain'=>$cfg['domain'],'before'=>$before,'after'=>$after,'updated'=>$updated,'self_deleted'=>$deleted],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''
def main():
 cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8'));b=cfg['beget'];host=cfg['ftp_host'];out={'mode':'tag_sitemap_fix','sites':[]}
 for s in cfg['sites']:
  tok=hashlib.sha256(os.urandom(32)).hexdigest();name='.seo-tagsm-'+hashlib.sha256((s['domain']+tok).encode()).hexdigest()[:18]+'.php';code=php(s['domain'],tok)
  with tempfile.NamedTemporaryFile('w',delete=False,suffix='.php',encoding='utf-8') as f:f.write(code);local=f.name
  ok,err=upload(host,b['user'],b['password'],s['ftp_wp_path'].rstrip('/')+'/'+name,local);os.unlink(local);item={'domain':s['domain'],'upload_ok':ok,'upload_error':err or None}
  if ok:
   st,u,body=req('https://'+s['domain']+'/'+name,{'X-SEO-Repair-Token':tok});item['invoke_status']=st
   try:item['change']=json.loads(body)
   except:item['change']={'raw':body[:800]}
   time.sleep(2);sst,su,sb=req('https://'+s['domain']+'/sitemap_index.xml?_seo_tagsm='+str(int(time.time())));children=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',sb,re.I);item['sitemap_status']=sst;item['tag_sitemaps_after']=[x for x in children if 'post_tag-sitemap' in x]
  out['sites'].append(item)
 json.dump(out,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2);print(json.dumps({'ok':True,'sites':len(out['sites'])}))
if __name__=='__main__':main()
