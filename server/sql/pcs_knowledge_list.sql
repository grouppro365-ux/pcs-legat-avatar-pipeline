create or replace function public.pcs_knowledge_list_v1(p_page integer default 0,p_query text default '',p_view text default 'all',p_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $fn$
declare items jsonb;
begin
 if p_page is null or p_page<0 or p_page>5000 or p_query is null or length(p_query)>120 or p_view is null or p_view not in ('all','active','draft','outdated','disabled','expired','customer_safe','approval_only','internal_only') then raise exception 'invalid_knowledge_filter';end if;
 select coalesce(jsonb_agg(t),'[]'::jsonb) into items from (
  select id,title,category,description,city,price::text price,currency,conditions,restrictions,source,status,visibility,auto_answer_allowed,verified_at,valid_until,revision,updated_at,operator_comment,answer_guidance,
  coalesce(valid_until<now(),false) expired,
  coalesce(status='active' and visibility='customer_safe' and auto_answer_allowed and (valid_until is null or valid_until>=now()),false) auto_eligible
  from public.pcs_knowledge_items
  where (p_id is null or id=p_id) and (p_view='all' or status=p_view or visibility=p_view or (p_view='expired' and valid_until<now())) and strpos(lower(concat_ws(' ',title,description,category,city,source,conditions,restrictions,answer_guidance)),lower(p_query))>0
  order by updated_at desc,id limit 51 offset p_page*50
 )t;
 return jsonb_build_object('rows',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(items) with ordinality e(value,n) where n<=50),'page',p_page,'q',p_query,'view',p_view,'has_more',jsonb_array_length(items)>50);
end $fn$;
revoke all on function public.pcs_knowledge_list_v1(integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.pcs_knowledge_list_v1(integer,text,text,uuid) to service_role;
