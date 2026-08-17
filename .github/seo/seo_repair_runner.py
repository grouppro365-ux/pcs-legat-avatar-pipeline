#!/usr/bin/env python3
import base64, hashlib, json, os, subprocess, tempfile, time, urllib.request, urllib.error, ssl
from html.parser import HTMLParser

UA='SEORepair/1.0'

class HeadParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.t=False; self.title=[]; self.meta={}; self.canonical=None
    def handle_starttag(self,tag,attrs):
        d={k.lower():(v or '') for k,v in attrs}; tag=tag.lower()
        if tag=='title': self.t=True
        elif tag=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k: self.meta[k]=d.get('content','').strip()
        elif tag=='link' and 'canonical' in d.get('rel','').lower().split(): self.canonical=d.get('href','').strip()
    def handle_endtag(self,tag):
        if tag.lower()=='title': self.t=False
    def handle_data(self,data):
        if self.t:self.title.append(data)
    def result(self):
        return {'title':' '.join(''.join(self.title).split()),'description':self.meta.get('description'),'robots':self.meta.get('robots'),'canonical':self.canonical}

def http(url,method='GET',body=None,headers=None,timeout=30):
    h={'User-Agent':UA,'Accept':'*/*'}; h.update(headers or {})
    data=None
    if body is not None:
        if isinstance(body,(dict,list)):
            data=json.dumps(body,ensure_ascii=False).encode(); h.setdefault('Content-Type','application/json')
        elif isinstance(body,str): data=body.encode()
        else: data=body
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout,context=ssl.create_default_context()) as r:
            return r.status,r.geturl(),r.read(2_000_000).decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code,getattr(e,'url',url),e.read(1_000_000).decode('utf-8','replace')
    except Exception as e:
        return None,url,type(e).__name__+': '+str(e)[:300]

def homepage(base):
    st,u,b=http(base+'/')
    p=HeadParser()
    try:p.feed(b)
    except Exception:pass
    r=p.result(); r.update({'status':st,'url':u}); return r

def robots(base):
    st,u,b=http(base+'/robots.txt')
    return {'status':st,'url':u,'body':b[:20000]}

def ftps_upload(host,user,password,remote_path,local_path):
    url=f"ftp://{host}/{remote_path.lstrip('/')}"
    p=subprocess.run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','15','--max-time','45','--user',f'{user}:{password}','--upload-file',local_path,url],capture_output=True,text=True)
    return p.returncode==0,(p.stderr or '').strip()[:500]

def make_php(site,token):
    domain=site['domain']; title=site['title']; desc=site['description']; focus=site['focus']; rb=site.get('robots_body')
    cfg={'domain':domain,'title':title,'description':desc,'focus':focus,'robots_body':rb,'token':token}
    encoded=base64.b64encode(json.dumps(cfg,ensure_ascii=False).encode()).decode()
    return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+encoded+"'"+r'''),true);
$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN'] ?? '';
if (!$got || !hash_equals($cfg['token'],$got)) { http_response_code(403); echo json_encode(['ok'=>false,'error'=>'forbidden']); exit; }
define('WP_USE_THEMES',false);
require_once __DIR__.'/wp-load.php';
$actual=parse_url(home_url('/'),PHP_URL_HOST);
if (strtolower((string)$actual)!==strtolower($cfg['domain'])) { http_response_code(409); echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual,'expected'=>$cfg['domain']]); @unlink(__FILE__); exit; }
$front=(int)get_option('page_on_front');
if (!$front) { http_response_code(409); echo json_encode(['ok'=>false,'error'=>'no_static_front']); @unlink(__FILE__); exit; }
$keys=['rank_math_title','rank_math_description','rank_math_focus_keyword'];
$before=[]; foreach($keys as $k){$before[$k]=get_post_meta($front,$k,true);}
$changes=[];
$changes['title']=update_post_meta($front,'rank_math_title',$cfg['title'])!==false;
$changes['description']=update_post_meta($front,'rank_math_description',$cfg['description'])!==false;
$changes['focus']=update_post_meta($front,'rank_math_focus_keyword',$cfg['focus'])!==false;
clean_post_cache($front); if(function_exists('wp_cache_flush')){wp_cache_flush();}
$robots=['requested'=>false,'written'=>false,'backup'=>null];
if (!empty($cfg['robots_body'])) {
  $robots['requested']=true;
  $path=__DIR__.'/robots.txt';
  if (is_file($path)) { $bak=__DIR__.'/robots.txt.seo-backup-'.gmdate('YmdHis'); if(@copy($path,$bak)){$robots['backup']=basename($bak);} }
  $robots['written']=file_put_contents($path,$cfg['robots_body'],LOCK_EX)!==false;
}
$after=[]; foreach($keys as $k){$after[$k]=get_post_meta($front,$k,true);}
$self=__FILE__; $deleted=@unlink($self);
echo json_encode(['ok'=>true,'domain'=>$cfg['domain'],'front_id'=>$front,'before'=>$before,'after'=>$after,'changes'=>$changes,'robots'=>$robots,'self_deleted'=>$deleted],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''

def main():
    cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8'))
    b=cfg['beget']; host=cfg.get('ftp_host') or b.get('hosts',[None])[0]
    report={'mode':'repair','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sites':[]}
    for site in cfg.get('sites',[]):
        d=site['domain']; base='https://'+d; path=site['ftp_wp_path'].rstrip('/')
        token=hashlib.sha256(os.urandom(32)).hexdigest()
        name='.seo-repair-'+hashlib.sha256((d+token).encode()).hexdigest()[:20]+'.php'
        php=make_php(site,token)
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',delete=False,suffix='.php') as f:
            f.write(php); local=f.name
        ok,err=ftps_upload(host,b['user'],b['password'],path+'/'+name,local); os.unlink(local)
        item={'domain':d,'upload_ok':ok,'upload_error':err or None,'script':name}
        if not ok: report['sites'].append(item); continue
        st,u,body=http(base+'/'+name,headers={'X-SEO-Repair-Token':token})
        item['invoke_status']=st
        try:item['repair_response']=json.loads(body)
        except Exception:item['repair_response']={'parse_error':body[:500]}
        # let caches settle a little
        time.sleep(2)
        item['homepage_after']=homepage(base)
        item['robots_after']=robots(base)
        chk,_,_=http(base+'/'+name)
        item['script_after_status']=chk
        report['sites'].append(item)
    report['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(report,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'ok':True,'sites':len(report['sites']),'invoked':sum(x.get('invoke_status')==200 for x in report['sites'])}))
if __name__=='__main__':main()
