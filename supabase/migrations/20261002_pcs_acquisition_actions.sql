create or replace function public.pcs_navi_placement(p_agreement uuid,p_source uuid,p_title text,p_campaign text,p_model text,p_currency text,p_requested numeric,p_agreed numeric,p_actor text,p_key text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare a pcs_partner_agreements;p pcs_ad_placements;l jsonb;begin
 select * into a from pcs_partner_agreements where id=p_agreement for update;
 if a.id is null or a.status<>'ACTIVE' or length(trim(p_actor))<3 then raise exception 'active_confirmed_agreement_required';end if;
 if p_model not in ('PAID','HYBRID','ORGANIC') or p_model<>a.model or length(trim(p_title))<2 or length(trim(p_campaign))<2 or length(p_key)<10 then raise exception 'invalid_placement';end if;
 insert into pcs_ad_placements(agreement_id,source_id,source_title,campaign,model,currency,requested_price,agreed_price,status,agreed_at,request_key)
 values(a.id,p_source,p_title,p_campaign,p_model,upper(p_currency),p_requested,p_agreed,'AGREED',now(),p_key) on conflict(request_key) do nothing;
 select * into p from pcs_ad_placements where request_key=p_key;
 if p.agreement_id<>a.id or p.source_id is distinct from p_source or p.campaign<>p_campaign then raise exception 'idempotency_conflict';end if;
 l:=pcs_navi_campaign(a.id,p_campaign,'https://vipthaiconcierge.com/',p_key||':link',p_actor,p.id);
 insert into pcs_acquisition_events(kind,agreement_id,placement_id,payload) select 'PLACEMENT_AGREED',a.id,p.id,jsonb_build_object('actor',p_actor) where not exists(select 1 from pcs_acquisition_events where placement_id=p.id and kind='PLACEMENT_AGREED');
 return jsonb_build_object('placement',to_jsonb(p),'link',l);
end;$$;
create or replace function public.pcs_navi_agreement_update(p_id uuid,p_status text,p_rate numeric,p_terms text,p_actor text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare a pcs_partner_agreements;begin
 select * into a from pcs_partner_agreements where id=p_id for update;
 if a.id is null or length(trim(p_actor))<3 or length(trim(p_terms))<3 or p_status not in ('ACTIVE','PAUSED','DISABLED') or p_rate not between 0 and 100 then raise exception 'explicit_amendment_required';end if;
 if a.model in ('PAID','ORGANIC') and p_rate<>0 then raise exception 'paid_model_has_no_commission';end if;
 insert into pcs_acquisition_events(kind,agreement_id,payload) values('OPERATOR_AGREEMENT_AMENDMENT',a.id,jsonb_build_object('actor',p_actor,'before',to_jsonb(a),'after',jsonb_build_object('rate',p_rate,'status',p_status,'terms',p_terms),'scope','NEW_CLIENTS_ONLY'));
 update pcs_partner_agreements set rate=p_rate,status=p_status,terms=p_terms,confirmed_by=p_actor,confirmed_at=now(),updated_at=now() where id=p_id;
 return jsonb_build_object('updated',true,'existing_client_terms_preserved',true);
end;$$;
revoke all on function public.pcs_navi_placement(uuid,uuid,text,text,text,text,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.pcs_navi_agreement_update(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.pcs_navi_placement(uuid,uuid,text,text,text,text,numeric,numeric,text,text),public.pcs_navi_agreement_update(uuid,text,numeric,text,text) to service_role;
