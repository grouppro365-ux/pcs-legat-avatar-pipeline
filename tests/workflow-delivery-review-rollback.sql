DECLARE u uuid:=gen_random_uuid(); app uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); unsent uuid:=gen_random_uuid(); active_event uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); version text; fingerprint text; r record; n int;
BEGIN
 CREATE TEMP TABLE applications(LIKE public.applications INCLUDING DEFAULTS INCLUDING INDEXES);
 CREATE TEMP TABLE pcs_workflow_outbox(LIKE public.pcs_workflow_outbox INCLUDING DEFAULTS INCLUDING INDEXES);
 CREATE TEMP TABLE notifications(LIKE public.notifications INCLUDING DEFAULTS INCLUDING INDEXES);
 CREATE TEMP TABLE audit_events(LIKE public.audit_events INCLUDING DEFAULTS INCLUDING INDEXES);
 INSERT INTO applications(id,public_id,category,operational_status) VALUES(app,'QA review','general','CONFIRMED');
 INSERT INTO pcs_workflow_outbox(id,aggregate_type,aggregate_id,event_type,idempotency_key,status,last_error,payload) VALUES
 (event,'APPLICATION',app,'CLIENT_FOLLOWUP_READY','qa:'||event,'CANCELLED','delivery_review_required',jsonb_build_object('channel','telegram','delivery_text','Synthetic public message')),
 (unsent,'APPLICATION',app,'CLIENT_WORKFLOW_NOTICE_READY','qa:'||unsent,'CANCELLED','delivery_review_required','{}'),
 (active_event,'APPLICATION',app,'PAYMENT_INSTRUCTIONS_READY','qa:'||active_event,'PROCESSING',null,'{}');
 INSERT INTO notifications(event_key,entity_type,entity_id,title,body,status,dedupe_key) VALUES('payment.instructions_review','applications',app::text,'QA review','QA only','PENDING','client-followup-review:'||event::text);
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(u,'QA reviewer','qa-review-'||u::text||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(u,'AUDITOR_READONLY',true);
 SELECT md5(to_jsonb(e)::text) INTO version FROM pcs_workflow_outbox e WHERE id=event;
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,repeat('0',32),'DELIVERED','Checked synthetic conversation',request,null::uuid;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA stale review accepted';END IF;
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'DELIVERED','Checked synthetic conversation',request,u;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA readonly staff can review delivery';END IF;
 PERFORM pcs.staff_manage(u,'OPS_ADMIN',true);
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'DELIVERED','Checked synthetic conversation',request,u;
 IF r.result->>'decision'<>'DELIVERED' OR (SELECT status FROM pcs_workflow_outbox WHERE id=event)<>'SENT' THEN RAISE EXCEPTION 'QA review not recorded';END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_events WHERE action='workflow_delivery_reviewed' AND actor_role='STAFF' AND patch->>'auth_user_id'=u::text) THEN RAISE EXCEPTION 'QA real reviewer identity missing';END IF;
 IF (SELECT count(*) FROM audit_events WHERE action='workflow_delivery_reviewed')<>1 OR NOT EXISTS(SELECT 1 FROM notifications WHERE read_at IS NOT NULL) THEN RAISE EXCEPTION 'QA audit/notice missing';END IF;
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'DELIVERED','Checked synthetic conversation',request,null::uuid;
 IF r.result IS NULL OR (SELECT count(*) FROM audit_events WHERE action='workflow_delivery_reviewed')<>1 THEN RAISE EXCEPTION 'QA replay duplicates or missing receipt';END IF;
 UPDATE neon_auth."user" SET banned=true WHERE id=u;
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'DELIVERED','Checked synthetic conversation',request,u;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA banned reviewer reads receipt';END IF;
 UPDATE neon_auth."user" SET banned=false WHERE id=u;
 PERFORM pcs.staff_manage(u,'OPS_ADMIN',false);
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'DELIVERED','Checked synthetic conversation',request,u;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA revoked reviewer reads receipt';END IF;
 EXECUTE $review$__REVIEW__$review$ INTO r USING event,version,'NOT_DELIVERED','Changed outcome',request,null::uuid;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA changed retry accepted';END IF;
 SELECT md5(to_jsonb(e)::text) INTO version FROM pcs_workflow_outbox e WHERE id=unsent;
 EXECUTE $review$__REVIEW__$review$ INTO r USING unsent,version,'DELIVERED','No prepared message present',gen_random_uuid(),null::uuid;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA unprepared delivery accepted';END IF;
 EXECUTE $review$__REVIEW__$review$ INTO r USING unsent,version,'NOT_DELIVERED','No prepared message present',gen_random_uuid(),null::uuid;
 IF r.result IS NULL OR (SELECT status FROM pcs_workflow_outbox WHERE id=unsent)<>'CANCELLED' OR (SELECT last_error FROM pcs_workflow_outbox WHERE id=unsent)<>'operator_not_delivered' THEN RAISE EXCEPTION 'QA negative review rearmed sending';END IF;
 SELECT md5(to_jsonb(e)::text) INTO version FROM pcs_workflow_outbox e WHERE id=active_event;
 EXECUTE $review$__REVIEW__$review$ INTO r USING active_event,version,'NOT_DELIVERED','Active lease must stay unchanged',gen_random_uuid(),null::uuid;
 IF r.result IS NOT NULL THEN RAISE EXCEPTION 'QA active delivery overwritten';END IF;
 n:=0;
 FOR r IN EXECUTE $list$__LIST__$list$ USING ARRAY['PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY','CLIENT_FOLLOWUP_READY'],'all',0,false LOOP
  n:=n+1;IF r.delivery_text IS NOT NULL THEN RAISE EXCEPTION 'QA frozen text exposed to readonly staff';END IF;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'QA outbox list incomplete';END IF;
 FOR r IN EXECUTE $list$__LIST__$list$ USING ARRAY['PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY','CLIENT_FOLLOWUP_READY'],'all',0,true LOOP
  IF r.id=event AND r.delivery_text<>'Synthetic public message' THEN RAISE EXCEPTION 'QA reviewer cannot compare exact text';END IF;
 END LOOP;
END;
