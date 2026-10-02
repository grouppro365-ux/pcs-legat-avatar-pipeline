create or replace function public.pcs_navi_sheets_data() returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare report jsonb;r jsonb;c jsonb;m jsonb;placements jsonb:='[]';snapshots jsonb:='[]';sources jsonb:='[]';clients jsonb:='[]';summary jsonb:='[]';s record;cur text;period record;links uuid[];spend numeric;cnt integer;label_no integer:=0;begin
 report:=pcs_navi_report();
 for r in select value from jsonb_array_elements(report->'placements') where value->>'model' in ('PAID','HYBRID') loop
  m:=r->'metrics';placements:=placements||jsonb_build_array(jsonb_build_array(r->>'source_title',r->>'campaign',case r->>'model' when 'PAID' then 'Оплата размещения' else 'Размещение и комиссия' end,
   case r->>'status' when 'AGREED' then 'Условия согласованы' when 'PAID' then 'Оплачено' when 'PUBLISHED' then 'Опубликовано' when 'COMPLETED' then 'Завершено' when 'CANCELLED' then 'Отменено' else 'В подготовке' end,r->>'currency',r->'requested_price',r->'agreed_price',m->'ad_spend',m->'clicks',m->'leads',m->'clients',m->'paid_clients',m->'orders',m->'lifetime_revenue',m->'commission',m->'cpl',m->'cac',m->'roas',r->'link'->>'url',to_char(now() at time zone 'Asia/Bangkok','DD.MM.YYYY HH24:MI'),r->>'id'));
 end loop;
 for s in select sn.*,p.source_title,p.campaign,p.currency from pcs_placement_snapshots sn join pcs_ad_placements p on p.id=sn.placement_id where p.model in ('PAID','HYBRID') order by sn.snapshot_date,p.id loop
  m:=s.metrics;snapshots:=snapshots||jsonb_build_array(jsonb_build_array(to_char(s.snapshot_date,'DD.MM.YYYY'),s.source_title,s.campaign,s.currency,m->'ad_spend',m->'clicks',m->'leads',m->'clients',m->'paid_clients',m->'orders',m->'lifetime_revenue',m->'commission',m->'cpl',m->'cac',m->'roas',s.placement_id::text||':'||s.snapshot_date::text));
 end loop;
 for s in select coalesce(source_id::text,agreement_id::text) as key,currency,min(source_title) title,count(*) n from pcs_ad_placements where model in ('PAID','HYBRID') group by coalesce(source_id::text,agreement_id::text),currency loop
  select coalesce(array_agg(l.id),'{}') into links from pcs_referral_links l join pcs_ad_placements p on p.id=l.placement_id where coalesce(p.source_id::text,p.agreement_id::text)=s.key;
  m:=pcs_navi_metrics(links,s.currency);select coalesce(sum((j->'metrics'->>'ad_spend')::numeric),0) into spend from jsonb_array_elements(report->'placements') j where coalesce(j->>'source_id',j->>'agreement_id')=s.key and j->>'currency'=s.currency;
  sources:=sources||jsonb_build_array(jsonb_build_array(s.title,s.currency,s.n,spend,m->'clicks',m->'leads',m->'clients',m->'paid_clients',m->'orders',m->'lifetime_revenue',case when (m->>'leads')::int>0 then spend/(m->>'leads')::int else null end,case when (m->>'clients')::int>0 then spend/(m->>'clients')::int else null end,case when spend>0 then (m->>'lifetime_revenue')::numeric/spend else null end,to_char(now() at time zone 'Asia/Bangkok','DD.MM.YYYY HH24:MI'),s.key||':'||s.currency));
 end loop;
 for c in select value from jsonb_array_elements(report->'clients') where value->>'placement_id' is not null order by value->>'attributed_at',value->>'contact_id' loop
  label_no:=label_no+1;select value into r from jsonb_array_elements(report->'placements') where value->>'id'=c->>'placement_id';
  for m in select value from jsonb_array_elements(c->'metrics') where value->>'currency'=r->>'currency' or (value->>'lifetime_revenue')::numeric<>0 loop
   clients:=clients||jsonb_build_array(jsonb_build_array('Клиент '||label_no,r->>'source_title',r->>'campaign',to_char((c->>'attributed_at')::timestamptz at time zone 'Asia/Bangkok','DD.MM.YYYY'),to_char((c->>'became_client_at')::timestamptz at time zone 'Asia/Bangkok','DD.MM.YYYY'),m->>'currency',m->'orders',m->'lifetime_revenue',m->'commission',to_char((m->>'last_order')::timestamptz at time zone 'Asia/Bangkok','DD.MM.YYYY'),c->>'contact_id'||':'||(m->>'currency')));
  end loop;
 end loop;
 select coalesce(array_agg(l.id),'{}') into links from pcs_referral_links l join pcs_ad_placements p on p.id=l.placement_id where p.model in ('PAID','HYBRID');
 for cur in select distinct currency from (select 'THB' currency union select currency from pcs_ad_placements where model in ('PAID','HYBRID') union select currency from pcs_commission_ledger where placement_id is not null) q loop
  for period in select 'Сегодня' title,date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' since union all select 'Последние 7 дней',now()-interval '7 days' union all select 'Текущий месяц',date_trunc('month',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' union all select 'За всё время',null::timestamptz loop
   m:=pcs_navi_metrics(links,cur,period.since);
   select coalesce(sum(f.amount),0),count(p.id) into spend,cnt from pcs_ad_placements p left join pcs_finance_entries f on f.id=p.finance_entry_id and f.status='paid' and f.entry_type='expense' and f.currency=cur and (period.since is null or coalesce(f.paid_at,f.created_at)>=period.since) where p.model in ('PAID','HYBRID') and p.currency=cur;
   summary:=summary||jsonb_build_array(jsonb_build_array(period.title,cur,cnt,spend,m->'clicks',m->'leads',m->'clients',m->'paid_clients',m->'attributed_revenue',m->'lifetime_revenue',case when (m->>'leads')::int>0 then spend/(m->>'leads')::int else null end,case when (m->>'clients')::int>0 then spend/(m->>'clients')::int else null end,case when spend>0 then (m->>'attributed_revenue')::numeric/spend else null end));
  end loop;
 end loop;
 return jsonb_build_object('СВОДКА',summary,'РАЗМЕЩЕНИЯ',placements,'ДИНАМИКА ПО ДНЯМ',snapshots,'ПЛОЩАДКИ',sources,'КЛИЕНТЫ ИЗ ПОСЕВОВ',clients,'updated_at',now(),'snapshot_date',(now() at time zone 'Asia/Bangkok')::date);
end;$$;
revoke all on function public.pcs_navi_sheets_data() from public,anon,authenticated;
grant execute on function public.pcs_navi_sheets_data() to service_role;
