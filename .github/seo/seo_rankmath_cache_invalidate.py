#!/usr/bin/env python3
import base64, hashlib, json, os, re, ssl, subprocess, tempfile, time
import urllib.error, urllib.request
from html.parser import HTMLParser

UA = 'SEORankMathNativeCacheFix/1.0'

class HeadParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.canonical = None
    def handle_starttag(self, tag, attrs):
        d = {k.lower(): (v or '') for k, v in attrs}
        tag = tag.lower()
        if tag == 'meta':
            key = (d.get('name') or d.get('property') or '').lower()
            if key:
                self.meta[key] = d.get('content', '').strip()
        elif tag == 'link' and 'canonical' in d.get('rel', '').lower().split():
            self.canonical = d.get('href', '').strip()

def upload(host, user, password, remote, local):
    p = subprocess.run([
        'curl', '--silent', '--show-error', '--fail', '--ssl-reqd',
        '--connect-timeout', '15', '--max-time', '45',
        '--user', f'{user}:{password}', '--upload-file', local,
        f"ftp://{host}/{remote.lstrip('/')}"
    ], capture_output=True, text=True)
    return p.returncode == 0, (p.stderr or '').strip()[:500]

def req(url, headers=None, timeout=45):
    h = {'User-Agent': UA, 'Accept': '*/*', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache'}
    h.update(headers or {})
    q = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(q, timeout=timeout, context=ssl.create_default_context()) as r:
            return r.status, r.geturl(), dict(r.headers), r.read(3_000_000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, getattr(e, 'url', url), dict(e.headers or {}), e.read(1_000_000).decode('utf-8', 'replace')
    except Exception as e:
        return None, url, {}, type(e).__name__ + ': ' + str(e)[:300]

def make_php(domain, token):
    cfg = base64.b64encode(json.dumps({'domain': domain, 'token': token}).encode()).decode()
    return r'''<?php
header('Content-Type: application/json; charset=utf-8');
$cfg = json_decode(base64_decode(''' + "'" + cfg + "'" + r'''), true);
$got = $_SERVER['HTTP_X_SEO_REPAIR_TOKEN'] ?? '';
if (!$got || !hash_equals($cfg['token'], $got)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}
define('WP_USE_THEMES', false);
require_once __DIR__ . '/wp-load.php';
$actual = parse_url(home_url('/'), PHP_URL_HOST);
if (strtolower((string)$actual) !== strtolower($cfg['domain'])) {
    http_response_code(409);
    echo json_encode(['ok' => false, 'error' => 'host_guard', 'actual' => $actual, 'expected' => $cfg['domain']]);
    @unlink(__FILE__);
    exit;
}

$titles = get_option('rank-math-options-titles', []);
$sitemap = get_option('rank-math-options-sitemap', []);
$robots = is_array($titles) ? ($titles['tax_post_tag_robots'] ?? null) : null;
$tag_sitemap = is_array($sitemap) ? ($sitemap['tax_post_tag_sitemap'] ?? null) : null;
$robots_array = is_array($robots) ? $robots : [$robots];
if (!in_array('noindex', $robots_array, true) || 'off' !== $tag_sitemap) {
    http_response_code(409);
    echo json_encode([
        'ok' => false,
        'error' => 'settings_guard',
        'tag_robots' => $robots,
        'tag_sitemap' => $tag_sitemap,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @unlink(__FILE__);
    exit;
}

if (!class_exists('\\RankMath\\Sitemap\\Cache')) {
    $cache_file = WP_PLUGIN_DIR . '/seo-by-rank-math/includes/modules/sitemap/class-cache.php';
    if (is_file($cache_file)) {
        require_once $cache_file;
    }
}
if (!class_exists('\\RankMath\\Sitemap\\Cache')) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'rank_math_cache_class_missing']);
    @unlink(__FILE__);
    exit;
}

global $wpdb;
$like = $wpdb->esc_like('_transient_sitemap_') . '%';
$transients_before = (int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s", $like));
$cache_dir = \RankMath\Sitemap\Cache::get_cache_directory();
$files_before = is_dir($cache_dir) ? array_values(array_diff(scandir($cache_dir), ['.', '..'])) : [];
$cached_files_before = \RankMath\Sitemap\Cache::cached_files();

// Official Rank Math sitemap cache invalidation API.
\RankMath\Sitemap\Cache::invalidate_storage();

if (function_exists('w3tc_flush_all')) {
    w3tc_flush_all();
}
if (function_exists('wp_cache_flush')) {
    wp_cache_flush();
}

$transients_after = (int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s", $like));
$files_after = is_dir($cache_dir) ? array_values(array_diff(scandir($cache_dir), ['.', '..'])) : [];
$cached_files_after = \RankMath\Sitemap\Cache::cached_files();
$deleted = @unlink(__FILE__);

echo json_encode([
    'ok' => true,
    'domain' => $cfg['domain'],
    'settings' => ['tag_robots' => $robots, 'tag_sitemap' => $tag_sitemap],
    'cache_dir' => $cache_dir,
    'transients_before' => $transients_before,
    'transients_after' => $transients_after,
    'files_before_count' => count($files_before),
    'files_after_count' => count($files_after),
    'cached_files_before_count' => is_array($cached_files_before) ? count($cached_files_before) : 0,
    'cached_files_after_count' => is_array($cached_files_after) ? count($cached_files_after) : 0,
    'self_deleted' => $deleted,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
?>'''

def verify_site(site):
    domain = site['domain']
    base = 'https://' + domain
    stamp = str(int(time.time()))
    result = {}
    for label, url in [
        ('sitemap_cache_busted', base + '/sitemap_index.xml?_rm_native=' + stamp),
        ('sitemap_plain', base + '/sitemap_index.xml'),
    ]:
        st, final, headers, body = req(url)
        locs = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', body, re.I)
        tag_maps = [u for u in locs if 'post_tag-sitemap' in u]
        result[label] = {
            'status': st,
            'final': final,
            'tag_sitemaps': tag_maps,
            'child_count': len(locs),
            'cache_headers': {k: v for k, v in headers.items() if k.lower() in ('age','cache-control','x-cache','x-cache-status','x-litespeed-cache','cf-cache-status','server')},
        }
    sample = site.get('sample_tag')
    if sample:
        st, final, headers, body = req(sample + ('&' if '?' in sample else '?') + '_rm_native=' + stamp)
        p = HeadParser()
        try:
            p.feed(body)
        except Exception:
            pass
        result['sample_tag'] = {
            'status': st,
            'final': final,
            'robots': p.meta.get('robots'),
            'canonical': p.canonical,
            'noindex': 'noindex' in (p.meta.get('robots') or '').lower(),
        }
    result['pass'] = (
        result['sitemap_cache_busted']['status'] == 200
        and result['sitemap_plain']['status'] == 200
        and not result['sitemap_cache_busted']['tag_sitemaps']
        and not result['sitemap_plain']['tag_sitemaps']
        and (not sample or result.get('sample_tag', {}).get('noindex') is True)
    )
    return result

def main():
    cfg = json.load(open(os.environ.get('SEO_PAYLOAD', '/tmp/seo-payload.json'), encoding='utf-8'))
    b = cfg['beget']
    host = cfg['ftp_host']
    out = {'mode': 'rankmath_native_cache_invalidate', 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'sites': []}
    for site in cfg['sites']:
        domain = site['domain']
        token = hashlib.sha256(os.urandom(32)).hexdigest()
        name = '.seo-rmcache-' + hashlib.sha256((domain + token).encode()).hexdigest()[:18] + '.php'
        code = make_php(domain, token)
        with tempfile.NamedTemporaryFile('w', delete=False, suffix='.php', encoding='utf-8') as f:
            f.write(code)
            local = f.name
        ok, err = upload(host, b['user'], b['password'], site['ftp_wp_path'].rstrip('/') + '/' + name, local)
        os.unlink(local)
        item = {'domain': domain, 'upload_ok': ok, 'upload_error': err or None}
        if ok:
            st, final, headers, body = req('https://' + domain + '/' + name, {'X-SEO-Repair-Token': token})
            item['invoke_status'] = st
            try:
                item['invalidation'] = json.loads(body)
            except Exception:
                item['invalidation'] = {'raw': body[:1000]}
            time.sleep(2)
            item['verification'] = verify_site(site)
            st2, _, _, _ = req('https://' + domain + '/' + name)
            item['script_after_status'] = st2
        out['sites'].append(item)
    out['all_pass'] = all(x.get('invoke_status') == 200 and x.get('verification', {}).get('pass') for x in out['sites'])
    out['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(out, open(os.environ.get('SEO_RESULT', '/tmp/seo-result.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(json.dumps({'all_pass': out['all_pass'], 'sites': len(out['sites'])}))
    raise SystemExit(0 if out['all_pass'] else 3)

if __name__ == '__main__':
    main()
