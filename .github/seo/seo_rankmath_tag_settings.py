#!/usr/bin/env python3
import base64,hashlib,json,os,subprocess,tempfile,urllib.request,urllib.error,ssl,time

def upload(host,user,pw,remote,local):
 p=subprocess.run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','15','--max-time','45','--user',f'{user}:{pw}','--upload-file',local,f"ftp://{host}/{remote.lstrip('/')}"],capture_output=True,text=True)
 return p.returncode==0,(p.stderr or '').strip()[:400]
def invoke(url,token):
 q=urllib.request.Request(url,headers={'X-SEO-Repair-Token':token,'User-Agent':'SEORankMathTagSettings/1.0'})
 try:
  with urllib.request.urlopen(q,timeout=45,context=ssl.create_default_context()) as r:return r.status,r.read().decode('utf-8','replace')
 except urllib.error.HTTPError as e:return e.code,e.read().decode('utf-8','replace')
 except Exception as e:return None,type(e).__name__+': '+str(e)[:300]
def php(domain,token):
 cfg=base64.b64encode(json.dumps({'domain':domain,'token':token}).encode()).decode()
 return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+cfg+"'"+r'''),true);
$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN'] ?? '';
if(!$got || !hash_equals($cfg['token'],$got)){http_response_code(403);echo json_encode(['ok'=>false]);exit;}
define('WP_USE_THEMES',false);require_once __DIR__.'/wp-load.php';
$actual=parse_url(home_url('/'),PHP_URL_HOST);
if(strtolower((string)$actual)!==strtolower($cfg['domain'])){http_response_code(409);echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual]);@unlink(__FILE__);exit;}
$out=['ok'=>true,'domain'=>$cfg['domain'],'options'=>[]];
foreach(['rank-math-options-titles','rank-math-options-sitemap'] as $name){
 $v=get_option($name,[]);$f=[];
 if(is_array($v)){foreach($v as $k=>$val){if(stripos((string)$k,'tag')!==false || stripos((string)$k,'post_tag')!==false){$f[$k]=$val;}}}
 $out['options'][$name]=$f;
}
$out['active_plugins']=(array)get_option('active_plugins',[]);
$out['self_deleted']=@unlink(__FILE__);
echo json_encode($out,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''
def main():
 cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8'));b=cfg['beget'];host=cfg['ftp_host'];out={'mode':'rankmath_tag_settings','sites':[]}
 for s in cfg['sites']:
  tok=hashlib.sha256(os.urandom(32)).hexdigest();name='.seo-rm-tag-'+hashlib.sha256((s['domain']+tok).encode()).hexdigest()[:18]+'.php';code=php(s['domain'],tok)
  with tempfile.NamedTemporaryFile('w',delete=False,suffix='.php',encoding='utf-8') as f:f.write(code);local=f.name
  ok,err=upload(host,b['user'],b['password'],s['ftp_wp_path'].rstrip('/')+'/'+name,local);os.unlink(local)
  item={'domain':s['domain'],'upload_ok':ok,'upload_error':err or None}
  if ok:
   st,body=invoke('https://'+s['domain']+'/'+name,tok);item['invoke_status']=st
   try:item['data']=json.loads(body)
   except:item['data']={'raw':body[:1000]}
  out['sites'].append(item)
 json.dump(out,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
 print(json.dumps({'ok':True,'sites':len(out['sites'])}))
if __name__=='__main__':main()
