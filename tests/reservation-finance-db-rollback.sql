-- Run after the schema SQL, in the same migration transaction. Every fixture rolls back.
do $$
declare c uuid; item uuid; r uuid; r2 uuid; f uuid; advance uuid; refund uuid; b jsonb;
begin
 begin
  insert into public.pcs_contacts(name,status,deal_stage,next_action,last_contact_at)
  values('PCS synthetic finance rollback','LOST','MANUAL','Keep manual action','2025-01-01') returning id into c;
  insert into public.pcs_catalog_items(category,title) values('vehicle','PCS synthetic finance rollback') returning id into item;
  insert into public.pcs_reservations(contact_id,catalog_item_id,start_date,end_date,total_amount)
  values(c,item,current_date,current_date+1,1000.13) returning id into r;
  insert into public.pcs_reservations(contact_id,catalog_item_id,start_date,end_date,total_amount)
  values(c,item,current_date,current_date+1,500) returning id into r2;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status)
  values(r,'expense',2000,'paid'),(r,'partner_payout',2000,'paid'),(r,'deposit',500,'paid');
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'unpaid' or (b->>'security_deposit_paid')::numeric<>500 then raise exception 'expense/deposit treated as rent'; end if;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,currency)
  values(r,'income',10000,'paid','USD');
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'unpaid' or jsonb_array_length(b->'other_currencies')<>1 then raise exception 'currency mixing'; end if;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,payment_kind)
  values(r,'income',600.13,'paid','prepayment') returning id into f;
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'partial' or (b->>'remaining')::numeric<>400 then raise exception 'partial/decimals'; end if;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,payment_kind)
  values(r,'income',400,'paid','booking_deposit') returning id into advance;
  if (select payment_status from public.pcs_reservations where id=r)<>'paid' then raise exception 'advance counts as rent'; end if;
  if exists(select 1 from public.pcs_contacts where id=c and (status<>'LOST' or deal_stage<>'MANUAL' or next_action<>'Keep manual action' or last_contact_at<>'2025-01-01'::timestamptz))
   or (select status from public.pcs_reservations where id=r)<>'requested' then raise exception 'manual CRM/service state changed'; end if;
  update public.pcs_finance_entries set amount=399 where id=advance;
  if (select payment_status from public.pcs_reservations where id=r)<>'partial' then raise exception 'amount update not recalculated'; end if;
  update public.pcs_finance_entries set amount=500 where id=advance;
  b:=public.pcs_reservation_finance_balance(r);
  if (b->>'overpayment')::numeric<>100 or b->>'payment_status'<>'paid' then raise exception 'overpayment'; end if;
  update public.pcs_reservations set total_amount=1500 where id=r;
  if (select payment_status from public.pcs_reservations where id=r)<>'partial' then raise exception 'price update'; end if;
  update public.pcs_reservations set total_amount=null where id=r;
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'partial' or (b->>'total_confirmed')::boolean or b->>'remaining' is not null then raise exception 'missing total'; end if;
  update public.pcs_reservations set total_amount=1000.13 where id=r;
  update public.pcs_finance_entries set reservation_id=r2 where id=advance;
  if (select payment_status from public.pcs_reservations where id=r)<>'partial' or (select payment_status from public.pcs_reservations where id=r2)<>'paid' then raise exception 'move requires both balances'; end if;
  update public.pcs_finance_entries set reservation_id=r where id=advance;
  begin
   delete from public.pcs_finance_entries where id=f;
   raise exception 'paid delete accepted';
  exception when others then if SQLERRM<>'paid_reservation_finance_requires_reversal_not_delete' then raise; end if; end;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
  values(r,'refund',200,'paid',jsonb_build_object('original_finance_entry_id',f::text)) returning id into refund;
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'partial' or (b->>'net_paid')::numeric<>900.13 then raise exception 'refund not subtracted'; end if;
  begin
   update public.pcs_finance_entries set amount=100 where id=f;
   raise exception 'original below refunds accepted';
  exception when others then if SQLERRM not in ('reservation_refund_requires_matching_paid_original_within_amount','reverse_refunds_before_original') then raise; end if; end;
  begin
   insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
   values(r,'refund',401,'paid',jsonb_build_object('original_finance_entry_id',f::text));
   raise exception 'excess refund accepted';
  exception when others then if SQLERRM<>'reservation_refund_requires_matching_paid_original_within_amount' then raise; end if; end;
  begin
   insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,currency,metadata)
   values(r,'refund',1,'paid','USD',jsonb_build_object('original_finance_entry_id',f::text));
   raise exception 'refund currency mismatch accepted';
  exception when others then if SQLERRM<>'reservation_refund_requires_matching_paid_original_within_amount' then raise; end if; end;
  begin
   insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
   values(r2,'refund',1,'paid',jsonb_build_object('original_finance_entry_id',f::text));
   raise exception 'refund booking mismatch accepted';
  exception when others then if SQLERRM<>'reservation_refund_requires_matching_paid_original_within_amount' then raise; end if; end;
  begin
   insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
   values(r,'refund',1,'paid','{}');
   raise exception 'unlinked refund accepted';
  exception when others then if SQLERRM<>'reservation_refund_requires_matching_paid_original_within_amount' then raise; end if; end;
  update public.pcs_finance_entries set amount=600.13 where id=refund;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
  values(r,'refund',500,'paid',jsonb_build_object('original_finance_entry_id',advance::text));
  if (select payment_status from public.pcs_reservations where id=r)<>'refunded' then raise exception 'full refund'; end if;
  update public.pcs_finance_entries set status='cancelled' where id=refund;
  if (select payment_status from public.pcs_reservations where id=r)<>'partial' then raise exception 'cancel refund'; end if;
  update public.pcs_finance_entries set status='cancelled' where id=f;
  if (select payment_status from public.pcs_reservations where id=r)<>'refunded' then raise exception 'cancel income recalculation'; end if;
  -- Security income is segregated from rent; its refund remains segregated.
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,payment_kind)
  values(r,'income',300,'paid','security_deposit') returning id into f;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status,metadata)
  values(r,'refund',100,'paid',jsonb_build_object('original_finance_entry_id',f::text));
  b:=public.pcs_reservation_finance_balance(r);
  if b->>'payment_status'<>'refunded' or (b->>'security_deposit_refunded')::numeric<>100 or (b->>'security_deposit_paid')::numeric<>800 then raise exception 'security segregation'; end if;
  update public.pcs_reservations set currency='EUR' where id=r;
  if (select payment_status from public.pcs_reservations where id=r)<>'unpaid' then raise exception 'booking currency update'; end if;
  insert into public.pcs_finance_entries(reservation_id,entry_type,amount,status)
  values(r2,'income',1,'planned') returning id into f;
  delete from public.pcs_finance_entries where id=f;
  if not exists(select 1 from public.pcs_audit_logs where entity_id=r::text and action='reservation_payment_recalculated') then raise exception 'missing audit'; end if;
  raise exception using errcode='Z0001',message='synthetic finance assertions complete; rollback';
 exception when sqlstate 'Z0001' then null; end;
 if exists(select 1 from public.pcs_reservations where id in (r,r2)) or exists(select 1 from public.pcs_audit_logs where entity_id in (r::text,r2::text)) then raise exception 'fixture rollback failed'; end if;
end $$;
