create unique index if not exists pcs_placement_one_expense on public.pcs_ad_placements(finance_entry_id) where finance_entry_id is not null;
create or replace function public.pcs_navi_placement_update(p_id uuid,p_status text,p_finance uuid,p_post_url text,p_actor text) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare p pcs_ad_placements;f pcs_finance_entries;begin
 select * into p from pcs_ad_placements where id=p_id for update;
 if p.id is null or length(trim(p_actor))<3 or p_status not in ('AGREED','AWAITING_PAYMENT','PAID','PUBLISHED','COMPLETED','CANCELLED') then raise exception 'operator_confirmation_required';end if;
 if p_finance is not null then
  select * into f from pcs_finance_entries where id=p_finance;
  if f.id is null or f.entry_type<>'expense' or f.status<>'paid' or f.currency<>p.currency then raise exception 'confirmed_placement_expense_required';end if;
  if p.finance_entry_id is not null and p.finance_entry_id<>p_finance then raise exception 'existing_expense_link_preserved';end if;
 end if;
 if p_status='PAID' and coalesce(p_finance,p.finance_entry_id) is null then raise exception 'confirmed_placement_expense_required';end if;
 if p_status in ('PUBLISHED','COMPLETED') and coalesce(nullif(p_post_url,''),p.post_url) is null then raise exception 'publication_url_required';end if;
 if nullif(p_post_url,'') is not null and p_post_url !~ '^https://' then raise exception 'invalid_publication_url';end if;
 update pcs_ad_placements set finance_entry_id=coalesce(p_finance,finance_entry_id),payment_status=case when coalesce(p_finance,finance_entry_id) is not null then 'PAID' else payment_status end,status=p_status,post_url=coalesce(nullif(p_post_url,''),post_url),published_at=case when p_status in ('PUBLISHED','COMPLETED') then coalesce(published_at,now()) else published_at end,updated_at=now() where id=p_id;
 insert into pcs_acquisition_events(kind,agreement_id,placement_id,payload) values('OPERATOR_PLACEMENT_UPDATE',p.agreement_id,p.id,jsonb_build_object('actor',p_actor,'before',to_jsonb(p),'status',p_status,'finance_entry_id',p_finance));return jsonb_build_object('updated',true);
end;$$;
create or replace function public.pcs_navi_link_payout(p_agreement uuid,p_finance uuid,p_actor text) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare f pcs_finance_entries;begin
 if length(trim(p_actor))<3 or not exists(select 1 from pcs_partner_agreements where id=p_agreement) then raise exception 'operator_confirmation_required';end if;
 select * into f from pcs_finance_entries where id=p_finance for update;
 if f.id is null or f.entry_type<>'partner_payout' or f.status<>'paid' then raise exception 'confirmed_partner_payout_required';end if;
 if f.metadata->>'navi_agreement_id' is not null and f.metadata->>'navi_agreement_id'<>p_agreement::text then raise exception 'payout_already_linked';end if;
 update pcs_finance_entries set metadata=coalesce(metadata,'{}')||jsonb_build_object('navi_agreement_id',p_agreement,'linked_by',p_actor),updated_at=now() where id=p_finance;
 insert into pcs_acquisition_events(kind,agreement_id,payload) select 'PAYOUT_LINKED',p_agreement,jsonb_build_object('finance_entry_id',p_finance,'actor',p_actor) where not exists(select 1 from pcs_acquisition_events where kind='PAYOUT_LINKED' and payload->>'finance_entry_id'=p_finance::text);return jsonb_build_object('updated',true);
end;$$;
revoke all on function public.pcs_navi_placement_update(uuid,text,uuid,text,text),public.pcs_navi_link_payout(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pcs_navi_placement_update(uuid,text,uuid,text,text),public.pcs_navi_link_payout(uuid,uuid,text) to service_role;
