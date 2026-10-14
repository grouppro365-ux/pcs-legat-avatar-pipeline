 -- New incident after completion remains visible without reopening fulfillment or clearing other reviews.
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 payload:=jsonb_build_object('application_id',app,'expected_version',version,'phase','OPEN','note','Synthetic post-service quality complaint','request_id',gen_random_uuid(),'confirmed','true');
 PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload);
 IF NOT EXISTS(SELECT 1 FROM applications WHERE id=app AND operational_status='COMPLETED' AND client_payment_status='PAID_TO_PARTNER' AND execution_issue_resolution IS NULL AND escalated_at IS NULL AND escalated_by IS NULL AND execution_issue_status='OPEN' AND human_review_required AND next_action_code='ARCHIVE_COMPLETED_SERVICE') THEN RAISE EXCEPTION 'QA new issue reopens service or loses independent state';END IF;
 EXECUTE $queue$__ISSUE_QUEUE__$queue$ INTO recorded USING 'attention',ARRAY['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'],(SELECT public_id FROM applications WHERE id=app),0;
 IF recorded.id IS DISTINCT FROM app THEN RAISE EXCEPTION 'QA completed issue hidden from attention queue';END IF;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 payload:=payload||jsonb_build_object('expected_version',version,'phase','RESOLVE','request_id',gen_random_uuid(),'note','Synthetic post-service complaint resolved');
 PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload);
 IF (SELECT execution_issue_resolution FROM applications WHERE id=app)<>'Synthetic post-service complaint resolved' OR (SELECT count(*) FROM pcs.execution_issue_commands WHERE application_id=app)<>5 THEN RAISE EXCEPTION 'QA resolution or prior issue receipts lost';END IF;
 PERFORM pcs.staff_manage(auth,'CONCIERGE_MANAGER',false);
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload);RAISE EXCEPTION 'QA revoked actor can replay issue';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM pcs.staff_manage(auth,'CONCIERGE_MANAGER',true);
