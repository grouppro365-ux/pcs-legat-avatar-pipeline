#!/usr/bin/env python3
import base64, hashlib, json, os, re, ssl, subprocess, tempfile, time
import urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser

UA='SEOFleetBegetRepair/1.0'
FTP_HOST=os.getenv('BEGET_FTP_HOST','legatbb9.beget.tech')
BEGET_USER=os.getenv('BEGET_USER','')
BEGET_PASSWORD=os.getenv('BEGET_PASSWORD','')
ROOT_COMPLETION='.seo-runner/fleet-completion.json'
ROOT_ACTIONABLE='.seo-runner/actionable-diagnostics.json'

H1_MODES={
    'ampliv.ru':'demote_home_label',
    'businessbrief.ru':'demote_site_title',
    'topentrepreneur.ru':'keep_first_site_title',
}

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.h1=None;self.h1s=[];self.meta={};self.canonical=None
    def handle_starttag(self,t,a):
        d={k.lower():(v or '') for k,v in a};t=t.lower()
        if t=='h1':self.h1=[]
        elif t=='meta':
            k=(d.get('name') or d.get('property') or '').lower()
            if k:self.meta[k]=d.get('content','').strip()
        elif t=='link' and 'canonical' in d.get('rel','').lower().split():self.canonical=d.get('href','').strip()
    def handle_data(self,d):
        if self.h1 is not None:self.h1.append(d)
    def handle_endtag(self,t):
        if t.lower()=='h1' and self.h1 is not None:
            self.h1s.append(' '.join(''.join(self.h1).split()));self.h1=None

def req(url,headers=None,timeout=45):
    h={'User-Agent':UA,'Accept':'*/*','Cache-Control':'no-cache','Pragma':'no-cache'};h.update(headers or {})
    q=urllib.request.Request(url,headers=h)
    try:
        with urllib.request.urlopen(q,timeout=timeout,context=ssl.create_default_context()) as r:
            return r.status,r.geturl(),dict(r.headers),r.read(4_000_000).decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code,getattr(e,'url',url),dict(e.headers or {}),e.read(1_000_000).decode('utf-8','replace')
    except Exception as e:
        return None,url,{},type(e).__name__+': '+str(e)[:300]

def ftp_upload(remote,body):
    with tempfile.NamedTemporaryFile('wb',delete=False) as f:
        f.write(body if isinstance(body,bytes) else body.encode('utf-8'));local=f.name
    try:
        p=subprocess.run([
            'curl','--silent','--show-error','--fail','--ssl-reqd',
            '--connect-timeout','15','--max-time','60','--user',f'{BEGET_USER}:{BEGET_PASSWORD}',
            '--upload-file',local,f"ftp://{FTP_HOST}/{remote.lstrip('/')}"
        ],capture_output=True,text=True)
        return p.returncode==0,(p.stderr or '').strip()[:500]
    finally:
        try:os.unlink(local)
        except:pass

def make_php(cfg):
    enc=base64.b64encode(json.dumps(cfg,ensure_ascii=False).encode()).decode()
    return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg=json_decode(base64_decode('''+"'"+enc+"'"+r'''),true);
$got=$_SERVER['HTTP_X_SEO_REPAIR_TOKEN']??'';
if(!$got||!hash_equals($cfg['token'],$got)){http_response_code(403);echo json_encode(['ok'=>false,'error'=>'forbidden']);exit;}
define('WP_USE_THEMES',false);require_once __DIR__.'/wp-load.php';
$actual=strtolower((string)parse_url(home_url('/'),PHP_URL_HOST));$expected=strtolower((string)$cfg['domain']);
if($actual!==$expected){http_response_code(409);echo json_encode(['ok'=>false,'error'=>'host_guard','actual'=>$actual,'expected'=>$expected]);@unlink(__FILE__);exit;}
$result=['ok'=>true,'domain'=>$expected,'actions'=>[]];

if(!empty($cfg['fix_tag'])){
    $titles=get_option('rank-math-options-titles',[]);$sitemap=get_option('rank-math-options-sitemap',[]);
    if(!is_array($titles))$titles=[];if(!is_array($sitemap))$sitemap=[];
    $beforeRobots=$titles['tax_post_tag_robots']??null;$beforeMap=$sitemap['tax_post_tag_sitemap']??null;
    $titles['tax_post_tag_robots']=['noindex'];$sitemap['tax_post_tag_sitemap']='off';
    update_option('rank-math-options-titles',$titles,false);update_option('rank-math-options-sitemap',$sitemap,false);
    if(!class_exists('\\RankMath\\Sitemap\\Cache')){
        $f=WP_PLUGIN_DIR.'/seo-by-rank-math/includes/modules/sitemap/class-cache.php';if(is_file($f))require_once $f;
    }
    if(class_exists('\\RankMath\\Sitemap\\Cache')){\\RankMath\\Sitemap\\Cache::invalidate_storage();$cache='invalidated';}else{$cache='class_missing';}
    $result['actions']['tag']=['before_robots'=>$beforeRobots,'before_sitemap'=>$beforeMap,'after_robots'=>$titles['tax_post_tag_robots'],'after_sitemap'=>$sitemap['tax_post_tag_sitemap'],'cache'=>$cache];
}

if(!empty($cfg['fix_robots'])){
    $path=ABSPATH.'robots.txt';$own='Sitemap: '.home_url('/sitemap_index.xml');
    if(is_file($path)){
        $body=(string)file_get_contents($path);$before=hash('sha256',$body);
        $body=preg_replace('/^\\s*Sitemap:\\s*\\S+\\s*$/mi','',$body);$body=rtrim($body)."\n\n".$own."\n";
        $written=file_put_contents($path,$body,LOCK_EX);$after=$written===false?null:hash_file('sha256',$path);
        $result['actions']['robots']=['mode'=>'physical','before_sha256'=>$before,'after_sha256'=>$after,'written'=>$written!==false];
        if($written===false)$result['ok']=false;
    }else{
        $dir=defined('WPMU_PLUGIN_DIR')?WPMU_PLUGIN_DIR:(WP_CONTENT_DIR.'/mu-plugins');if(!is_dir($dir))wp_mkdir_p($dir);
        $guard=<<<'PHP'
<?php
/** Plugin Name: SEO Robots Sitemap Guard */
defined('ABSPATH')||exit;
add_filter('robots_txt',static function($output,$public){
    $own='Sitemap: '.home_url('/sitemap_index.xml');
    $output=preg_replace('/^\\s*Sitemap:\\s*\\S+\\s*$/mi','',$output);
    return rtrim((string)$output)."\n\n".$own."\n";
},999,2);
PHP;
        $path=$dir.'/seo-robots-sitemap-guard.php';$written=file_put_contents($path,$guard,LOCK_EX);
        $result['actions']['robots']=['mode'=>'mu_guard','written'=>$written!==false,'sha256'=>$written===false?null:hash_file('sha256',$path)];if($written===false)$result['ok']=false;
    }
}

if(!empty($cfg['fix_https'])){
    $dir=defined('WPMU_PLUGIN_DIR')?WPMU_PLUGIN_DIR:(WP_CONTENT_DIR.'/mu-plugins');if(!is_dir($dir))wp_mkdir_p($dir);
    $guard=<<<'PHP'
<?php
/** Plugin Name: SEO HTTPS Canonical Redirect Guard */
defined('ABSPATH')||exit;
add_action('template_redirect',static function(){
    if(is_admin()||wp_doing_ajax())return;
    $xfp=strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO']??''));
    if(is_ssl()||$xfp==='https')return;
    $host=strtolower((string)parse_url(home_url('/'),PHP_URL_HOST));
    $reqHost=strtolower(preg_replace('/:\\d+$/','',(string)($_SERVER['HTTP_HOST']??'')));
    if(!$host||$reqHost!==$host)return;
    $uri=(string)($_SERVER['REQUEST_URI']??'/');wp_safe_redirect('https://'.$host.$uri,301);exit;
},-1000);
PHP;
    $path=$dir.'/seo-https-canonical-redirect.php';$written=file_put_contents($path,$guard,LOCK_EX);
    $result['actions']['https']=['written'=>$written!==false,'sha256'=>$written===false?null:hash_file('sha256',$path)];if($written===false)$result['ok']=false;
}

if(!empty($cfg['h1_mode'])){
    $dir=defined('WPMU_PLUGIN_DIR')?WPMU_PLUGIN_DIR:(WP_CONTENT_DIR.'/mu-plugins');if(!is_dir($dir))wp_mkdir_p($dir);
    $mode=$cfg['h1_mode'];
    $plugin="<?php\n/** Plugin Name: SEO Homepage H1 Normalizer v2 */\ndefined('ABSPATH')||exit;\n";
    $plugin.="add_action('template_redirect',static function(){if(is_admin()||!is_front_page()||wp_doing_ajax())return;ob_start(static function(\\$html){\\$mode='".addslashes($mode)."';\\$seen=0;return preg_replace_callback('~<h1\\\\b([^>]*)>(.*?)</h1\\\\s*>~is',static function(\\$m)use(&\\$seen,\\$mode){\\$attrs=\\$m[1];\\$inner=\\$m[2];\\$text=trim(preg_replace('/\\\\s+/u',' ',wp_strip_all_tags(\\$inner)));\\$class='';if(preg_match('/\\\\bclass\\\\s*=\\\\s*([\"\\\\\'])(.*?)\\\\1/is',\\$attrs,\\$cm))\\$class=\\$cm[2];\\$site=preg_match('/(?:^|\\\\s)site-title(?:\\\\s|$)/',\\$class)===1;\\$home=function_exists('mb_strtolower')?mb_strtolower(\\$text,'UTF-8')==='главная':strtolower(\\$text)==='главная';\\$demote=false;if(\\$mode==='demote_home_label')\\$demote=\\$home;elseif(\\$mode==='demote_site_title')\\$demote=\\$site;elseif(\\$mode==='keep_first_site_title'&&\\$site){\\$seen++;\\$demote=\\$seen>1;}return \\$demote?'<div'.\\$attrs.'>'.\\$inner.'</div>':\\$m[0];},\\$html);});},0);\n";
    $path=$dir.'/seo-home-h1-normalizer-v2.php';$written=file_put_contents($path,$plugin,LOCK_EX);
    $result['actions']['h1']=['mode'=>$mode,'written'=>$written!==false,'sha256'=>$written===false?null:hash_file('sha256',$path)];if($written===false)$result['ok']=false;
}

if(function_exists('w3tc_flush_all'))w3tc_flush_all();if(function_exists('wp_cache_flush'))wp_cache_flush();do_action('litespeed_purge_all');
$deleted=@unlink(__FILE__);$result['self_deleted']=$deleted;
echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
?>'''

def parse_page(body):
    p=PageParser()
    try:p.feed(body)
    except:pass
    return p

def verify(site):
    d=site['domain'];stamp=str(int(time.time()));out={'domain':d,'checks':{}}
    if site['fix_tag']:
        vals=[]
        for u in [f'https://{d}/sitemap_index.xml',f'https://{d}/sitemap_index.xml?_seo_fleet={stamp}']:
            st,final,headers,body=req(u);locs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>',body,re.I);vals.append({'status':st,'tag_maps':[x for x in locs if 'post_tag-sitemap' in x]})
        out['tag']=vals;out['checks']['tag']=all(x['status']==200 and not x['tag_maps'] for x in vals)
        st,_,_,body=req(f'https://{d}/wp-json/wp/v2/tags?per_page=1&_fields=link')
        try:tags=json.loads(body)
        except:tags=[]
        if st==200 and isinstance(tags,list) and tags:
            st2,_,_,b2=req(tags[0].get('link','')+'?_seo_tag='+stamp);pp=parse_page(b2);out['tag_sample']={'status':st2,'robots':pp.meta.get('robots'),'noindex':'noindex' in (pp.meta.get('robots') or '').lower()};out['checks']['tag_noindex']=st2==200 and out['tag_sample']['noindex']
        else:out['checks']['tag_noindex']=True
    if site['fix_robots']:
        st,_,_,body=req(f'https://{d}/robots.txt?_seo_robots={stamp}');maps=re.findall(r'(?im)^\s*Sitemap:\s*(\S+)',body);own=f'https://{d}/sitemap_index.xml';out['robots']={'status':st,'sitemaps':maps};out['checks']['robots']=st==200 and maps==[own]
    if site['fix_https']:
        st,final,_,_=req(f'http://{d}/?_seo_https={stamp}');out['https']={'status':st,'final':final};out['checks']['https']=st==200 and final.startswith(f'https://{d}/')
    if site['h1_mode']:
        h=[]
        for u in [f'https://{d}/',f'https://{d}/?_seo_h1={stamp}']:
            st,final,_,body=req(u);p=parse_page(body);h.append({'status':st,'h1s':p.h1s})
        out['h1']=h;out['checks']['h1']=all(x['status']==200 and len(x['h1s'])==1 for x in h)
    out['pass']=all(out['checks'].values()) if out['checks'] else True
    return out

def build_targets():
    comp=json.load(open(ROOT_COMPLETION,encoding='utf-8'));act=json.load(open(ROOT_ACTIONABLE,encoding='utf-8'))
    unreachable=set(comp['issue_buckets'].get('reachable',[]));tags=set(comp['issue_buckets'].get('no_tag_sitemaps',[]))-unreachable
    robots={x['domain'] for x in act.get('robots',[]) if x.get('kind')=='foreign_or_wrong_sitemap'}
    https=set(act.get('summary',{}).get('https_live_nonredirect',[]))
    domains=sorted((tags|robots|https|set(H1_MODES))-{'capitrx.ru'})
    return [{'domain':d,'ftp_wp_path':d+'/public_html','fix_tag':d in tags,'fix_robots':d in robots,'fix_https':d in https,'h1_mode':H1_MODES.get(d)} for d in domains]

def repair_one(site):
    d=site['domain'];token=hashlib.sha256(os.urandom(32)).hexdigest();name='.seo-fleet-'+hashlib.sha256((d+token).encode()).hexdigest()[:18]+'.php';cfg=dict(site,token=token);body=make_php(cfg)
    ok,err=ftp_upload(site['ftp_wp_path'].rstrip('/')+'/'+name,body);item={'domain':d,'flags':{k:site[k] for k in ('fix_tag','fix_robots','fix_https','h1_mode')},'upload_ok':ok,'upload_error':err or None}
    if not ok:return item
    st,final,headers,res=req(f'https://{d}/{name}',{'X-SEO-Repair-Token':token});item['invoke_status']=st
    try:item['repair']=json.loads(res)
    except:item['repair']={'raw':res[:1200]}
    time.sleep(1);item['verification']=verify(site);st2,_,_,_=req(f'https://{d}/{name}');item['installer_after_status']=st2
    return item

def main():
    if not BEGET_USER or not BEGET_PASSWORD:
        print(json.dumps({'ok':False,'error':'missing_BEGET_USER_or_BEGET_PASSWORD'}));raise SystemExit(2)
    targets=build_targets();out={'mode':'guarded_beget_fleet_repair','started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'target_count':len(targets),'sites':[]}
    with ThreadPoolExecutor(max_workers=5) as ex:
        fut={ex.submit(repair_one,s):s['domain'] for s in targets}
        for f in as_completed(fut):
            try:out['sites'].append(f.result())
            except Exception as e:out['sites'].append({'domain':fut[f],'fatal':type(e).__name__+': '+str(e)[:300]})
    order=[x['domain'] for x in targets];out['sites'].sort(key=lambda x:order.index(x['domain']))
    out['passed']=sum(x.get('invoke_status')==200 and x.get('verification',{}).get('pass') and x.get('installer_after_status')==404 for x in out['sites']);out['all_pass']=out['passed']==len(targets);out['finished_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    json.dump(out,open('seo-fleet-repair-result.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps({'all_pass':out['all_pass'],'passed':out['passed'],'total':len(targets)}));raise SystemExit(0 if out['all_pass'] else 3)
if __name__=='__main__':main()
