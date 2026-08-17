#!/usr/bin/env python3
import base64, hashlib, json, os, ssl, subprocess, tempfile, time
import urllib.error, urllib.request
from html.parser import HTMLParser

UA='SEOH1NormalizerInstaller/1.0'

MU_PLUGIN = r'''<?php
/**
 * Plugin Name: SEO Homepage H1 Normalizer
 * Description: Keeps exactly one meaningful H1 on the front page without editing theme core files.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;

add_action('template_redirect', static function () {
    if (is_admin() || !is_front_page() || wp_doing_ajax()) {
        return;
    }

    ob_start(static function ($html) {
        if (!is_string($html) || stripos($html, '<h1') === false) {
            return $html;
        }

        return preg_replace_callback(
            '~<h1\\b([^>]*)>(.*?)</h1\\s*>~is',
            static function ($m) {
                $attrs = $m[1];
                $inner = $m[2];
                $text  = trim(preg_replace('/\\s+/u', ' ', wp_strip_all_tags($inner)));
                $class = '';
                if (preg_match('/\\bclass\\s*=\\s*(["\\\'])(.*?)\\1/is', $attrs, $cm)) {
                    $class = $cm[2];
                }

                $is_site_title = preg_match('/(?:^|\\s)site-title(?:\\s|$)/', $class) === 1;
                $is_generic_home = function_exists('mb_strtolower')
                    ? mb_strtolower($text, 'UTF-8') === 'главная'
                    : strtolower($text) === 'главная';

                if (!$is_site_title && !$is_generic_home) {
                    return $m[0];
                }

                return '<div' . $attrs . '>' . $inner . '</div>';
            },
            $html
        );
    });
}, 0);
'''

class H1Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.current=None;self.h1s=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=='h1':self.current=[]
    def handle_data(self,data):
        if self.current is not None:self.current.append(data)
    def handle_endtag(self,tag):
        if tag.lower()=='h1' and self.current is not None:
            self.h1s.append(' '.join(''.join(self.current).split()));self.current=None

def upload(host,user,pw,remote,local):
    p=subprocess.run(['curl','--silent','--show-error','--fail','--ssl-reqd','--connect-timeout','15','--max-time','45','--user',f'{user}:{pw}','--upload-file',local,f"ftp://{host}/{remote.lstrip('/')}"],capture_output=True,text=True)
    return p.returncode==0,(p.stderr or '').strip()[:500]

def req(url,headers=None,timeout=45):
    h={'User-Agent':UA,'Accept':'*/*','Cache-Control':'no-cache','Pragma':'no-cache'};h.update(headers or {})
    q=urllib.request.Request(url,headers=h)
    try:
        with urllib.request.urlopen(q,timeout=timeout,context=ssl.create_default_context()) as r:return r.status,r.geturl(),dict(r.headers),r.read(4_000_000).decode('utf-8','replace')
    except urllib.error.HTTPError as e:return e.code,getattr(e,'url',url),dict(e.headers or {}),e.read(1_000_000).decode('utf-8','replace')
    except Exception as e:return None,url,{},type(e).__name__+': '+str(e)[:300]

def make_installer(domain,token,plugin_b64,expected_h1):
    cfg=base64.b64encode(json.dumps({'domain':domain,'token':token,'plugin_b64':plugin_b64,'expected_h1':expected_h1},ensure_ascii=False).encode()).decode()
    return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+cfg+"'"+r'''),true);$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN']??'';
if(!$got||!hash_equals($cfg['token'],$got)){http_response_code(403);echo json_encode(['ok'=>false,'error'=>'forbidden']);exit;}
define('WP_USE_THEMES',false);require_once __DIR__.'/wp-load.php';
$actual=parse_url(home_url('/'),PHP_URL_HOST);
if(strtolower((string)$actual)!==strtolower($cfg['domain'])){http_response_code(409);echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual,'expected'=>$cfg['domain']]);@unlink(__FILE__);exit;}
$dir=defined('WPMU_PLUGIN_DIR')?WPMU_PLUGIN_DIR:(WP_CONTENT_DIR.'/mu-plugins');
if(!is_dir($dir)&&!wp_mkdir_p($dir)){http_response_code(500);echo json_encode(['ok'=>false,'error'=>'mkdir_failed','dir'=>$dir]);@unlink(__FILE__);exit;}
$path=$dir.'/seo-home-h1-normalizer.php';$before=is_file($path)?hash_file('sha256',$path):null;$body=base64_decode($cfg['plugin_b64']);
$written=file_put_contents($path,$body,LOCK_EX);if($written===false){http_response_code(500);echo json_encode(['ok'=>false,'error'=>'write_failed']);@unlink(__FILE__);exit;}
@chmod($path,0644);$after=hash_file('sha256',$path);
if(function_exists('w3tc_flush_all'))w3tc_flush_all();if(function_exists('wp_cache_flush'))wp_cache_flush();do_action('litespeed_purge_all');
$deleted=@unlink(__FILE__);
echo json_encode(['ok'=>true,'domain'=>$cfg['domain'],'mu_plugin'=>basename($path),'before_sha256'=>$before,'after_sha256'=>$after,'bytes'=>$written,'expected_h1'=>$cfg['expected_h1'],'self_deleted'=>$deleted],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''

def verify(site):
    stamp=str(int(time.time()));base='https://'+site['domain']
    out={}
    for label,url in [('cache_busted',base+'/?_seo_h1='+stamp),('plain',base+'/')]:
        st,final,headers,body=req(url);p=H1Parser()
        try:p.feed(body)
        except Exception:pass
        out[label]={'status':st,'final':final,'h1_count':len(p.h1s),'h1s':p.h1s,'cache_headers':{k:v for k,v in headers.items() if k.lower() in ('server','cache-control','x-cache','x-cache-status')}}
    exp=site['expected_h1']
    out['pass']=all(out[x]['status']==200 and out[x]['h1_count']==1 and out[x]['h1s']==[exp] for x in ('cache_busted','plain'))
    return out

def main():
    cfg=json.load(open(os.environ.get('SEO_PAYLOAD','/tmp/seo-payload.json'),encoding='utf-8'));b=cfg['beget'];host=cfg['ftp_host'];plugin_b64=base64.b64encode(MU_PLUGIN.encode()).decode();out={'mode':'h1_mu_install','sites':[]}
    for site in cfg['sites']:
        token=hashlib.sha256(os.urandom(32)).hexdigest();name='.seo-h1install-'+hashlib.sha256((site['domain']+token).encode()).hexdigest()[:18]+'.php';code=make_installer(site['domain'],token,plugin_b64,site['expected_h1'])
        with tempfile.NamedTemporaryFile('w',delete=False,suffix='.php',encoding='utf-8') as f:f.write(code);local=f.name
        ok,err=upload(host,b['user'],b['password'],site['ftp_wp_path'].rstrip('/')+'/'+name,local);os.unlink(local);item={'domain':site['domain'],'upload_ok':ok,'upload_error':err or None}
        if ok:
            st,final,headers,body=req('https://'+site['domain']+'/'+name,{'X-SEO-Repair-Token':token});item['invoke_status']=st
            try:item['install']=json.loads(body)
            except:item['install']={'raw':body[:1000]}
            time.sleep(2);item['verification']=verify(site);st2,_,_,_=req('https://'+site['domain']+'/'+name);item['installer_after_status']=st2
        out['sites'].append(item)
    out['all_pass']=all(x.get('invoke_status')==200 and x.get('verification',{}).get('pass') and x.get('installer_after_status')==404 for x in out['sites'])
    json.dump(out,open(os.environ.get('SEO_RESULT','/tmp/seo-result.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2);print(json.dumps({'all_pass':out['all_pass'],'sites':len(out['sites'])}));raise SystemExit(0 if out['all_pass'] else 3)
if __name__=='__main__':main()
