CREATE OR REPLACE FUNCTION public.pcs_navi_reconcile_finance(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare f pcs_finance_entries; orig pcs_finance_entries;ca pcs_client_attribution;cid uuid; eligible numeric:=0; prior numeric:=0;prevcommission numeric:=0;targetcommission numeric;rev integer;rate numeric;okey text; refunded numeric;cutoff timestamptz;begin
 select * into f from pcs_finance_entries where id=p_id for update;
 if f.id is null then raise exception 'finance_not_found';end if;
 cid:=coalesce(f.contact_id,(select contact_id from pcs_reservations where id=f.reservation_id),(select contact_id from pcs_deals where id=f.deal_id));
 if exists(select 1 from pcs_commission_ledger l where l.finance_entry_id=f.id and (l.contact_id is distinct from cid or l.currency<>f.currency or l.order_key<>coalesce(case when f.entry_type='refund' then (select coalesce(o.reservation_id::text,o.deal_id::text,o.id::text) from pcs_finance_entries o where o.id=nullif(f.metadata->>'original_finance_entry_id','')::uuid) else coalesce(f.reservation_id::text,f.deal_id::text,f.id::text) end,''))) then raise exception 'posted_finance_identity_immutable';end if;
 if f.entry_type='income' then
  select coalesce(sum(amount),0) into refunded from pcs_finance_entries where entry_type='refund' and status='paid' and metadata->>'original_finance_entry_id'=f.id::text;
  if refunded>0 and (f.status<>'paid' or f.amount<refunded) then raise exception 'reverse_refunds_before_original';end if;
 end if;
 select * into ca from pcs_client_attribution where contact_id=cid;
 if ca.contact_id is null then return jsonb_build_object('attributed',false);end if;
 cutoff:=coalesce((select created_at from pcs_attribution_touches where id=ca.touch_id),ca.attributed_at);
 rate:=case when ca.model_snapshot in ('REFERRAL','HYBRID') then ca.rate_snapshot else 0 end;
 if f.status='paid' and f.entry_type='income' and coalesce(f.paid_at,f.created_at)>=cutoff and (f.payment_kind in ('full','prepayment','booking_deposit') or f.metadata->>'eligible_revenue'='true') then eligible:=f.amount;end if;
 if f.entry_type='refund' and f.metadata->>'original_finance_entry_id' ~ '^[0-9a-f-]{36}$' then
  select * into orig from pcs_finance_entries where id=(f.metadata->>'original_finance_entry_id')::uuid for update;
  if orig.id is null or orig.entry_type<>'income' or orig.currency<>f.currency or coalesce(orig.contact_id,(select contact_id from pcs_reservations where id=orig.reservation_id),(select contact_id from pcs_deals where id=orig.deal_id)) is distinct from cid then raise exception 'refund_original_mismatch';end if;
  if f.status='paid' then
   select coalesce(sum(amount),0) into refunded from pcs_finance_entries where id<>f.id and entry_type='refund' and status='paid' and metadata->>'original_finance_entry_id'=orig.id::text;
   if orig.status<>'paid' or refunded+f.amount>orig.amount then raise exception 'refund_exceeds_paid_original';end if;
  end if;
  if f.status='paid' and coalesce(orig.paid_at,orig.created_at)>=cutoff and (orig.payment_kind in ('full','prepayment','booking_deposit') or orig.metadata->>'eligible_revenue'='true') then eligible:=-f.amount;end if;
 end if;
 if f.entry_type='refund' and orig.id is null then raise exception 'refund_requires_original';end if;
 if f.amount<0 then raise exception 'finance_amount_must_be_positive';end if;
 select coalesce(sum(revenue_delta),0),coalesce(sum(commission_delta),0),coalesce(max(revision),0)+1 into prior,prevcommission,rev from pcs_commission_ledger where finance_entry_id=f.id;
 targetcommission:=round(eligible*rate/100,2);
 if prior=eligible and prevcommission=targetcommission then return jsonb_build_object('changed',false);end if;
 okey:=case when f.entry_type='refund' then coalesce(orig.reservation_id::text,orig.deal_id::text,orig.id::text) else coalesce(f.reservation_id::text,f.deal_id::text,f.id::text) end;
 insert into pcs_commission_ledger(finance_entry_id,revision,contact_id,agreement_id,link_id,placement_id,order_key,currency,revenue_delta,commission_delta,rate_snapshot,reason,effective_at)
 values(f.id,rev,cid,ca.agreement_id,ca.link_id,ca.placement_id,okey,f.currency,eligible-prior,targetcommission-prevcommission,rate,case when eligible<0 then 'REFUND' when eligible=0 then 'REVERSAL' else 'PAID_CASH_RECEIVED' end,case when rev=1 then coalesce(f.paid_at,now()) else now() end);
 if eligible>0 then update pcs_client_attribution set became_client_at=coalesce(became_client_at,f.paid_at,now()),qualified_at=coalesce(qualified_at,f.paid_at,now()) where contact_id=cid;end if;
 insert into pcs_acquisition_events(kind,agreement_id,placement_id,contact_id,payload) values(case when eligible-prior>0 then 'REVENUE' else 'REVENUE_ADJUSTMENT' end,ca.agreement_id,ca.placement_id,cid,jsonb_build_object('finance_entry_id',f.id,'revenue_delta',eligible-prior,'commission_delta',targetcommission-prevcommission,'currency',f.currency,'order_key',okey));
 return jsonb_build_object('changed',true,'revenue_delta',eligible-prior,'commission_delta',targetcommission-prevcommission);
end;$function$;

CREATE OR REPLACE FUNCTION public.pcs_navi_reconcile() RETURNS jsonb LANGUAGE plpgsql SET search_path TO public,pg_temp AS $$declare rec record;n integer:=0;begin
 for rec in select f.id from pcs_finance_entries f where coalesce(f.contact_id,(select r.contact_id from pcs_reservations r where r.id=f.reservation_id),(select d.contact_id from pcs_deals d where d.id=f.deal_id)) in (select contact_id from pcs_client_attribution) order by case when f.entry_type='refund' then 1 else 0 end,f.created_at loop perform pcs_navi_reconcile_finance(rec.id);n:=n+1;end loop;
 return jsonb_build_object('finance_checked',n,'checked_at',now());end;$$;
