#!/usr/bin/env python3
import json, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import seo_final_audit as base


def audit_strict(site):
    out = base.audit(site)
    domain = out['domain']

    # Homepage heading structure is a hard gate: exactly one non-empty H1.
    h1s = out.get('homepage', {}).get('h1s', [])
    out['checks']['single_h1'] = len(h1s) == 1 and bool((h1s[0] if h1s else '').strip())

    # No tag archive sitemap is allowed in either normal or cache-busted XML index.
    plain_children = out.get('sitemap', {}).get('children', [])
    plain_tags = [u for u in plain_children if 'post_tag-sitemap' in u]
    stamp = str(int(time.time()))
    bust = base.req(f'https://{domain}/sitemap_index.xml?_seo_strict={stamp}')
    bust_children = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', bust.get('body', ''), re.I)
    bust_tags = [u for u in bust_children if 'post_tag-sitemap' in u]
    out['sitemap']['tag_sitemaps_plain'] = plain_tags
    out['sitemap']['tag_sitemaps_cache_busted'] = bust_tags
    out['sitemap']['cache_busted_status'] = bust.get('status')
    out['checks']['no_tag_sitemaps_plain'] = not plain_tags
    out['checks']['no_tag_sitemaps_cache_busted'] = bust.get('status') == 200 and not bust_tags

    out['pass'] = all(out['checks'].values())
    return out


def main():
    report = {
        'mode': 'strict_final_regression_with_h1',
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'sites': [],
    }
    with ThreadPoolExecutor(max_workers=5) as ex:
        fut = {ex.submit(audit_strict, s): s[0] for s in base.SITES}
        for f in as_completed(fut):
            try:
                report['sites'].append(f.result())
            except Exception as e:
                report['sites'].append({
                    'domain': fut[f],
                    'pass': False,
                    'fatal': type(e).__name__ + ': ' + str(e)[:300],
                })
    order = [s[0] for s in base.SITES]
    report['sites'].sort(key=lambda x: order.index(x['domain']))
    report['passed'] = sum(bool(x.get('pass')) for x in report['sites'])
    report['total'] = len(report['sites'])
    report['all_pass'] = report['passed'] == report['total']
    report['single_h1_passed'] = sum(bool(x.get('checks', {}).get('single_h1')) for x in report['sites'])
    report['total_tag_sitemaps_plain'] = sum(len(x.get('sitemap', {}).get('tag_sitemaps_plain', [])) for x in report['sites'])
    report['total_tag_sitemaps_cache_busted'] = sum(len(x.get('sitemap', {}).get('tag_sitemaps_cache_busted', [])) for x in report['sites'])
    report['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(report, open('seo-final-strict-report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(json.dumps({
        'all_pass': report['all_pass'],
        'passed': report['passed'],
        'total': report['total'],
        'single_h1_passed': report['single_h1_passed'],
        'tag_sitemaps_plain': report['total_tag_sitemaps_plain'],
        'tag_sitemaps_cache_busted': report['total_tag_sitemaps_cache_busted'],
    }))
    raise SystemExit(0 if report['all_pass'] else 3)


if __name__ == '__main__':
    main()
