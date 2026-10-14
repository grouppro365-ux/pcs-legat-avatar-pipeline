 -- Real-table issue lifecycle: independent flags, atomic receipts, named actor and internal escalation.
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 payload:=jsonb_build_object('application_id',app,'expected_version',version,'phase','OPEN','note','Synthetic provider failed to deliver service','request_id',gen_random_uuid(),'confirmed','true');
 PERFORM pcs.staff_manage(auth,'AUDITOR_READONLY',true);
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload);RAISE EXCEPTION 'QA readonly can manage issue';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM pcs.staff_manage(auth,'CONCIERGE_MANAGER',true);
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload||'{"confirmed":"false"}');RAISE EXCEPTION 'QA issue without confirmation';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=pcs.staff_workflow_action(auth,'execution-issue',payload);replay:=pcs.staff_workflow_action(auth,'execution-issue',payload);
 IF r->>'issue_status'<>'OPEN' OR replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA issue receipt missing';END IF;
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload||'{"note":"Changed issue after saved request"}');RAISE EXCEPTION 'QA changed issue retry accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 IF (SELECT count(*) FROM audit_events WHERE entity_id=app::text AND action='execution.issue.open')<>1 OR (SELECT count(*) FROM notifications WHERE entity_id=app::text AND dedupe_key='execution-issue:'||app::text||':'||(payload->>'request_id'))<>1 THEN RAISE EXCEPTION 'QA duplicate issue audit or notification';END IF;
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload||jsonb_build_object('request_id',gen_random_uuid()));RAISE EXCEPTION 'QA stale issue version accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 payload:=payload||jsonb_build_object('phase','ESCALATE','expected_version',version,'request_id',gen_random_uuid(),'note','Synthetic escalation to duty manager');
 PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload);
 IF NOT EXISTS(SELECT 1 FROM public.applications a JOIN public.app_users u ON u.id=a.escalated_by WHERE a.id=app AND a.execution_issue_status='ESCALATED' AND a.escalated_at IS NOT NULL AND u.external_id=auth::text AND a.operational_status='SERVICE_IN_PROGRESS' AND a.client_payment_status='PARTIALLY_PAID' AND a.human_review_required) THEN RAISE EXCEPTION 'QA escalation actor or independent state lost';END IF;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 BEGIN PERFORM pcs.staff_workflow_action(auth,'execution-issue',payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version));RAISE EXCEPTION 'QA duplicate escalation accepted';EXCEPTION WHEN check_violation THEN NULL;END;
