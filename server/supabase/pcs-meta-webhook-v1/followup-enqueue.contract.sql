-- Integration contract. Every synthetic write is rolled back by the inner exception block.
DO $test$
DECLARE
  cid uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid();
  account text; thread text:=(floor(random()*9000000000000000)+1000000)::bigint::text;
  recipient text:=(floor(random()*9000000000000000)+1000000)::bigint::text;
  cfg jsonb; result jsonb; snapshot jsonb; report text:='failed:unreached';
BEGIN
  BEGIN
    ASSERT to_regprocedure('public.pcs_instagram_followup_enqueue(uuid,text,jsonb)') IS NOT NULL,'missing_enqueue_rpc';
    ASSERT NOT has_function_privilege('anon','public.pcs_instagram_followup_enqueue(uuid,text,jsonb)','EXECUTE'),'anonymous_enqueue_allowed';
    ASSERT NOT has_function_privilege('authenticated','public.pcs_instagram_followup_enqueue(uuid,text,jsonb)','EXECUTE'),'client_enqueue_allowed';
    ASSERT has_function_privilege('service_role','public.pcs_instagram_followup_enqueue(uuid,text,jsonb)','EXECUTE'),'service_enqueue_denied';
    cfg:=public.pcs_secret_get('channel_instagram_local_bridge')::jsonb;
    account:=cfg->>'account_id';
    ASSERT account ~ '^[0-9]{1,80}$','fixture_account_unavailable';
    IF jsonb_typeof(cfg->'pilot_recipient_ids')='array' AND jsonb_array_length(cfg->'pilot_recipient_ids')>0 THEN
      recipient:=cfg->'pilot_recipient_ids'->>0;
    END IF;
    INSERT INTO public.pcs_contacts(id,name,status,followup_enabled) VALUES(cid,'PCS rollback fixture','NEW',true);
    INSERT INTO public.pcs_messages(id,contact_id,direction,text,status,channel,external_message_id,external_chat_id,created_at)
      VALUES(mid,cid,'in','Ford Fiesta Pattaya 2026-11-10 - 2026-11-12','received','instagram',
        'instagrapi:'||account||':'||recipient,'instagrapi:'||account||':'||thread,now()-interval '1 minute');
    INSERT INTO public.pcs_ai_generations(id,contact_id,source_message_id,provider,model,intent,confidence,risk,requires_human,
      answer,policy_decision,policy_reason,status,business_connection_id,source_text,created_at)
      VALUES(gid,cid,mid,'deterministic','pcs-rollback-original','car_rent',1,'low',false,'Fixture original reply','auto',
        'local_instagram_outbox','sent','instagram','Ford Fiesta Pattaya 2026-11-10 - 2026-11-12',now()-interval '50 seconds');
    INSERT INTO public.pcs_instagram_outbox(generation_id,account_id,thread_id,recipient_id,reply_text,status,provider_message_id)
      VALUES(gid,account,thread,recipient,'Fixture original reply','sent',recipient);
    INSERT INTO public.pcs_customer_followups(id,generation_id,source_message_id,contact_id,business_connection_id,kind,status)
      VALUES(fid,gid,mid,cid,'instagram','car_rent','processing');
    snapshot:=jsonb_build_object('version',1,'intent','car_rent','start_date','2026-11-10','end_date','2026-11-12',
      'options',jsonb_build_array(jsonb_build_object('catalog_item_id',gen_random_uuid(),'title','Rollback car',
        'total_before_extras',1320,'currency','THB','security_deposit_thb',5000)));
    BEGIN
      UPDATE public.pcs_contacts SET status='OPTED_OUT' WHERE id=cid;
      PERFORM public.pcs_instagram_followup_enqueue(fid,'Regression offer - 1320 THB',snapshot);
      ASSERT false,'opted_out_was_enqueued';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='contact_ineligible','wrong_optout_failure'; END;
    BEGIN
      INSERT INTO public.pcs_messages(contact_id,direction,text,status,channel,created_at)
        VALUES(cid,'in','Please change the dates','received','instagram',now());
      PERFORM public.pcs_instagram_followup_enqueue(fid,'Regression offer - 1320 THB',snapshot);
      ASSERT false,'superseded_was_enqueued';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='followup_superseded','wrong_stale_failure'; END;
    BEGIN
      PERFORM public.pcs_instagram_followup_enqueue(fid,'Regression offer - 1320 THB',snapshot||'{"internal_margin":200}'::jsonb);
      ASSERT false,'private_fields_were_enqueued';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='non_public_offer_fields','wrong_private_field_failure'; END;
    result:=public.pcs_instagram_followup_enqueue(fid,'Regression offer - 1320 THB',snapshot);
    ASSERT result->'queued'='true'::jsonb AND result->>'generation_id'=fid::text,'enqueue_not_accepted';
    ASSERT (SELECT status='queued' FROM public.pcs_customer_followups WHERE id=fid),'queued_marked_delivered';
    ASSERT (SELECT status='pending_send' AND offer_snapshot=snapshot FROM public.pcs_ai_generations WHERE id=fid),'quote_not_frozen';
    ASSERT (SELECT status='pending' AND account_id=account AND thread_id=thread AND recipient_id=recipient
      FROM public.pcs_instagram_outbox WHERE generation_id=fid),'original_route_not_preserved';
    result:=public.pcs_instagram_followup_enqueue(fid,'Changed price - 9999 THB',snapshot);
    ASSERT result->'queued'='true'::jsonb,'idempotent_retry_failed';
    ASSERT (SELECT count(*)=1 FROM public.pcs_instagram_outbox WHERE generation_id=fid),'duplicate_queue_record';
    ASSERT (SELECT reply_text='Regression offer - 1320 THB' FROM public.pcs_instagram_outbox WHERE generation_id=fid),'retry_changed_reply';
    ASSERT (SELECT status='queued' FROM public.pcs_customer_followups WHERE id=fid),'retry_faked_delivery';
    report:='passed:atomic_route_frozen_quote_idempotency_service_only_optout_stale_private_fields';
    RAISE EXCEPTION USING ERRCODE='P0901',MESSAGE='rollback_synthetic_fixture';
  EXCEPTION
    WHEN SQLSTATE 'P0901' THEN NULL;
    WHEN assert_failure THEN report:='failed:'||SQLERRM;
    WHEN undefined_function THEN report:='failed:enqueue_missing';
    WHEN OTHERS THEN report:='failed:sqlstate_'||SQLSTATE;
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.pcs_contacts WHERE id=cid),'fixture_not_rolled_back';
  ASSERT NOT EXISTS(SELECT 1 FROM public.pcs_instagram_outbox WHERE generation_id IN(gid,fid)),'fixture_queue_survived';
  PERFORM set_config('pcs_test.instagram_followup_result',report,false);
END $test$;
SELECT current_setting('pcs_test.instagram_followup_result') AS integration_result;
