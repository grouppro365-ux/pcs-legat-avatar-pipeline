 DECLARE foreign_partner uuid:=gen_random_uuid();ch text;h jsonb;first jsonb;seen jsonb;page_no integer;expected uuid[];actual uuid[];
 BEGIN
 SELECT token_hash INTO ch FROM pcs.portal_access WHERE client_profile_id=client AND role='CLIENT';
 FOREACH ch IN ARRAY ARRAY[ch,partner_hash] LOOP
  seen:='[]';
  FOR page_no IN 0..5 LOOP
   h:=pcs.portal_application_history(ch,app,'payments',page_no);
   IF jsonb_array_length(h->'rows')<>(CASE WHEN page_no=5 THEN 9 ELSE 100 END) OR (h->>'has_more')::boolean IS DISTINCT FROM (page_no<5) OR (h#>>'{payment_balance,verified_amount}')::numeric<>1005.15 THEN RAISE EXCEPTION 'QA payment history boundary/balance';END IF;
   seen:=seen||(h->'rows');
  END LOOP;
  SELECT array_agg(id ORDER BY created_at DESC,id) INTO expected FROM pcs.application_payment_claims WHERE application_id=app;
  SELECT array_agg((value->>'id')::uuid ORDER BY ord) INTO actual FROM jsonb_array_elements(seen) WITH ORDINALITY v(value,ord);
  IF actual IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM jsonb_array_elements(seen) v WHERE v->>'application_id'<>app::text OR jsonb_typeof(v->'amount_thb')<>'string' OR v ? 'client_profile_id') THEN RAISE EXCEPTION 'QA history order/privacy/decimal changed';END IF;
  IF jsonb_array_length(pcs.portal_application_history(ch,app,'payments',6)->'rows')<>0 THEN RAISE EXCEPTION 'QA history empty page';END IF;
  BEGIN PERFORM pcs.portal_application_history(ch,other_app,'payments',0);RAISE EXCEPTION 'QA foreign history allowed';EXCEPTION WHEN no_data_found THEN NULL;END;
  BEGIN PERFORM pcs.portal_application_history(ch,app,'payments',5001);RAISE EXCEPTION 'QA unbounded history allowed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 -- Preserve existing public offer policy: client sees approved/unexpired or accepted only;
 -- the assigned partner sees their own non-public drafts/rejections as well.
 INSERT INTO public.pcs_partner_offers(application_id,partner_id,status,client_price_thb,deposit_thb,terms,reviewed_at,expires_at)
 SELECT app,partner,'APPROVED',1000.25,2000,'QA public offer '||n,now(),now()+interval '1 day' FROM generate_series(1,501) n;
 INSERT INTO public.pcs_partner_offers(application_id,partner_id,status,client_price_thb,deposit_thb,terms,expires_at)
 SELECT app,partner,state,1000.25,2000,'QA private offer',now()+interval '1 day' FROM unnest(ARRAY['DRAFT','SUBMITTED','REJECTED']) state;
 INSERT INTO public.partners(id,public_name,status) VALUES(foreign_partner,'QA other offer partner','ACTIVE');
 INSERT INTO public.pcs_partner_offers(application_id,partner_id,status,client_price_thb,deposit_thb,terms,expires_at) VALUES(app,foreign_partner,'APPROVED',1000.25,0,'QA other partner public terms',now()+interval '1 day'),(app,partner,'APPROVED',1000.25,0,'QA expired public terms',now()-interval '1 day');
 SELECT token_hash INTO ch FROM pcs.portal_access WHERE client_profile_id=client AND role='CLIENT';
 h:=pcs.portal_application_history(ch,app,'offers',5);
 IF jsonb_array_length(h->'rows')<>2 OR h->>'has_more'<>'false' OR EXISTS(SELECT 1 FROM jsonb_array_elements(h->'rows') v WHERE v->>'status' NOT IN ('APPROVED','ACCEPTED') OR v ? 'internal_notes' OR v ? 'net_price_thb') THEN RAISE EXCEPTION 'QA client offer history boundary/privacy';END IF;
 h:=pcs.portal_application_history(partner_hash,app,'offers',5);
 IF jsonb_array_length(h->'rows')<>5 OR h->>'has_more'<>'false' THEN RAISE EXCEPTION 'QA partner own draft history missing';END IF;
 UPDATE public.client_profiles SET blocked=true WHERE id=client;
 BEGIN PERFORM pcs.portal_application_history(ch,app,'payments',1);RAISE EXCEPTION 'QA blocked client history allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.client_profiles SET blocked=false WHERE id=client;
 UPDATE pcs.portal_access SET expires_at=now()-interval '1 second' WHERE token_hash=partner_hash;
 BEGIN PERFORM pcs.portal_application_history(partner_hash,app,'offers',1);RAISE EXCEPTION 'QA expired history allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE pcs.portal_access SET expires_at=now()+interval '1 day' WHERE token_hash=partner_hash;
 END;
