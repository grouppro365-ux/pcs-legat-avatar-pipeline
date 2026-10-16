import {CrmError} from './crm-policy.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function attributionFilters(input={},now=new Date()){
 const to=input.to||now.toISOString().slice(0,10);
 if(typeof to!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(to+'T00:00:00Z')))throw new CrmError('Проверьте даты отчёта',400);
 const from=input.from||new Date(Date.parse(to+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>365*86400000||!/^\d{1,4}$/.test(String(input.page??0))||Number(input.page??0)>1000)throw new CrmError('Проверьте даты отчёта (не более 366 дней) и страницу',400);
 return {from,to,start:from+'T00:00:00.000Z',end:new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString(),page:Number(input.page??0)};
}
// Source binding is the persisted UUID from the existing identity provisioner. No name/phone inference.
export const attributionBusinessQuery=`with ids as (select unnest($1::uuid[]) source_contact_id),
 profiles as (select i.source_contact_id,count(p.id)::int profile_count,(array_agg(p.id) filter(where p.id is not null))[1] profile_id
 from ids i left join public.client_profiles p on p.source_contact_id=i.source_contact_id and p.merged_into_id is null and p.blocked is not true group by i.source_contact_id)
 select p.source_contact_id,p.profile_count,
 (select count(*)::int from public.applications a where a.client_profile_id=p.profile_id and p.profile_count=1 and a.created_at >= $2::timestamptz and a.created_at < $3::timestamptz) applications,
 (select coalesce(sum(c.amount_thb),0)::text from pcs.application_payment_claims c join public.applications a on a.id=c.application_id
 where a.client_profile_id=p.profile_id and p.profile_count=1 and c.client_profile_id=p.profile_id and c.status='VERIFIED' and c.reviewed_at >= $2::timestamptz and c.reviewed_at < $3::timestamptz) verified_gross_thb,
 coalesce((select jsonb_agg(t order by t.currency,t.status) from (select s.currency,s.status,sum(s.expected_pcs_amount)::text expected_amount,count(*)::int records
 from public.settlements s join public.applications a on a.id=s.application_id where a.client_profile_id=p.profile_id and p.profile_count=1
 and s.created_at >= $2::timestamptz and s.created_at < $3::timestamptz and s.expected_pcs_amount is not null group by s.currency,s.status) t),'[]'::jsonb) expected_commissions
 from profiles p order by p.source_contact_id`;
async function read(base,key,table,params,fetcher){
 const url=new URL(base+'/rest/v1/'+table);for(const [k,v] of Object.entries(params))url.searchParams.append(k,String(v));
 const r=await fetcher(url.toString(),{headers:{apikey:key,authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('source_unavailable');const rows=await r.json();if(!Array.isArray(rows))throw Error('source_invalid');return rows;
}
export async function readAttributionReport(biz,base,key,input={},fetcher=fetch){
 const filters=attributionFilters(input),{start,end,page}=filters,limit=100,unavailable=[];
 const sources=await Promise.allSettled([
  read(base,key,'pcs_client_attribution',{select:'contact_id,placement_id,agreement_id,attributed_at,qualified_at,became_client_at',and:`(attributed_at.gte.${start},attributed_at.lt.${end})`,order:'attributed_at.desc,contact_id',limit:101,offset:page*limit},fetcher),
  read(base,key,'pcs_acquisition_events',{select:'id,kind,placement_id,agreement_id,created_at',and:`(created_at.gte.${start},created_at.lt.${end})`,order:'created_at.desc,id.desc',limit:101,offset:page*limit},fetcher)
 ]);
 const names=['attribution','acquisition_events'];for(let i=0;i<sources.length;i++)if(sources[i].status!=='fulfilled')unavailable.push(names[i]);
 const cohort=sources[0].status==='fulfilled'?sources[0].value:[],events=sources[1].status==='fulfilled'?sources[1].value:[];
 if(cohort.some(x=>!UUID.test(String(x.contact_id))))throw new CrmError('Некорректный ответ атрибуции',503);
 const ids=[...new Set(cohort.slice(0,limit).map(x=>x.contact_id))],placements=[...new Set([...cohort.slice(0,limit),...events.slice(0,limit)].map(x=>x.placement_id).filter(x=>UUID.test(String(x))))];
 const details=await Promise.allSettled([
  ids.length?biz.query(attributionBusinessQuery,[ids,start,end]):Promise.resolve([]),
  placements.length?read(base,key,'pcs_ad_placements',{select:'id,source_title,campaign,status,payment_status,agreed_price::text,currency,published_at',id:'in.('+placements.join(',')+')',limit:200},fetcher):Promise.resolve([])
 ]);
 if(details[0].status!=='fulfilled')unavailable.push('canonical_business');if(details[1].status!=='fulfilled')unavailable.push('placements');
 const business=new Map((details[0].status==='fulfilled'?details[0].value:[]).map(x=>[x.source_contact_id,x]));
 const placementRows=details[1].status==='fulfilled'?details[1].value:[],placementMap=new Map(placementRows.map(x=>[x.id,x]));
 const rows=cohort.slice(0,limit).map(x=>{const b=business.get(x.contact_id);return {...x,source_title:placementMap.get(x.placement_id)?.source_title||null,campaign:placementMap.get(x.placement_id)?.campaign||null,business:b||null};});
 return {from:filters.from,to:filters.to,page,limit,timezone:'UTC',rows,events:events.slice(0,limit),placements:placementRows,
  truncated:{attribution:cohort.length>limit,acquisition_events:events.length>limit},unavailable,
  semantics:{scope:'page_cohort',association:'persisted attribution, not causal revenue or last-touch reconstruction',identity:'persisted_source_contact_id',client_money:'VERIFIED gross transfers in THB by reviewed_at; before refunds; not PCS revenue',commission:'expected amounts on settlement records created in period, grouped by currency; not received revenue',publication:'stored placement status; not independent live verification'}};
}
