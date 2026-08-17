#!/usr/bin/env python3
import json, collections

src=json.load(open('.seo-runner/fleet-discovery.json',encoding='utf-8'))
known_done=set(src.get('known_done_in_sheet') or [])
sites=src.get('sites') or []

patterns=collections.defaultdict(list)
for s in sites:
    patterns[tuple(s.get('issues') or [])].append(s.get('domain'))

def failing(check):
    return [s['domain'] for s in sites if not s.get('checks',{}).get(check,False)]

def details(domains):
    wanted=set(domains); out=[]
    for s in sites:
        if s['domain'] not in wanted: continue
        out.append({
            'domain':s['domain'],
            'issues':s.get('issues',[]),
            'homepage_status':s.get('homepage',{}).get('status'),
            'homepage_error':s.get('homepage',{}).get('error'),
            'h1s':s.get('homepage',{}).get('h1s',[]),
            'robots_status':s.get('robots',{}).get('status'),
            'robots_sitemaps':s.get('robots',{}).get('sitemaps',[]),
            'robots_disallow_root':s.get('robots',{}).get('disallow_root'),
            'sitemap_status':s.get('sitemap',{}).get('status'),
            'tag_plain_count':len(s.get('sitemap',{}).get('tag_sitemaps_plain',[])),
            'tag_busted_count':len(s.get('sitemap',{}).get('tag_sitemaps_cache_busted',[])),
            'rankmath':s.get('wp',{}).get('rankmath'),
            'wp_status':s.get('wp',{}).get('status'),
        })
    return out

checks=['reachable','https_preferred','title_present','description_present','canonical_self','home_indexable','single_h1','robots_ok','sitemap_ok','no_tag_sitemaps','rankmath_rest','sample_post_ok']
buckets={k:failing(k) for k in checks}
remaining=[s['domain'] for s in sites if s['domain'] not in known_done]
clean=[s['domain'] for s in sites if s.get('pass_structural')]
clean_remaining=[d for d in clean if d not in known_done]

plan={
    'source_rows':src.get('source_rows'),
    'audited_url_rows':src.get('audited_url_rows'),
    'unresolved_sheet_entries':src.get('unresolved_sheet_entries'),
    'known_done_in_sheet':sorted(known_done),
    'remaining_url_domains_count':len(remaining),
    'clean_remaining':clean_remaining,
    'repair_needed_remaining':[d for d in remaining if d not in clean],
    'bucket_counts':{k:len(v) for k,v in buckets.items()},
    'buckets':buckets,
    'unreachable_details':details(buckets['reachable']),
    'h1_details':details(buckets['single_h1']),
    'robots_details':details(buckets['robots_ok']),
    'tag_details':details(buckets['no_tag_sitemaps']),
    'rankmath_details':details(buckets['rankmath_rest']),
    'issue_patterns':[{'issues':list(k),'count':len(v),'domains':v} for k,v in sorted(patterns.items(),key=lambda kv:(-len(kv[1]),kv[0]))],
}
json.dump(plan,open('seo-fleet-plan.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(json.dumps({'remaining':len(remaining),'clean_remaining':len(clean_remaining),'repair_needed_remaining':len(plan['repair_needed_remaining']),'pattern_count':len(patterns),'bucket_counts':plan['bucket_counts']},ensure_ascii=False))
