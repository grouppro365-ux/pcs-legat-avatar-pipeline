-- Operator issue lifecycle on existing application fields; no customer sends or finance writes.
CREATE TABLE IF NOT EXISTS pcs.execution_issue_commands (
 application_id uuid NOT NULL REFERENCES public.applications(id),request_id uuid NOT NULL,
 fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(application_id,request_id)
);
REVOKE ALL ON pcs.execution_issue_commands FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.manage_execution_issue(p_payload jsonb,p_actor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE a public.applications%ROWTYPE; receipt pcs.execution_issue_commands%ROWTYPE; phase text; target text; fingerprint text; result jsonb;
BEGIN
 phase:=p_payload->>'phase';
 IF phase NOT IN ('OPEN','ESCALATE','RESOLVE') OR phase IS NULL OR p_payload->>'confirmed' IS DISTINCT FROM 'true' OR length(trim(coalesce(p_payload->>'note',''))) NOT BETWEEN 10 AND 1000 OR coalesce(p_payload->>'request_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'portal_issue_input_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.applications WHERE id=(p_payload->>'application_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_application_not_found' USING ERRCODE='P0002';END IF;
 fingerprint:=md5(p_payload::text);
 SELECT * INTO receipt FROM pcs.execution_issue_commands WHERE application_id=a.id AND request_id=(p_payload->>'request_id')::uuid;
 IF FOUND THEN
  IF receipt.fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'portal_retry_changed' USING ERRCODE='23505';END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF a.updated_at::text IS DISTINCT FROM p_payload->>'expected_version' THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001';END IF;
 IF (phase='OPEN' AND (coalesce(a.execution_issue_status,'UNKNOWN') NOT IN ('NONE','RESOLVED') OR a.operational_status NOT IN ('CONFIRMED','SERVICE_IN_PROGRESS','COMPLETED')))
 OR (phase='ESCALATE' AND a.execution_issue_status IS DISTINCT FROM 'OPEN')
 OR (phase='RESOLVE' AND coalesce(a.execution_issue_status,'UNKNOWN') NOT IN ('OPEN','ESCALATED')) THEN RAISE EXCEPTION 'portal_issue_not_available' USING ERRCODE='23514';END IF;
 target:=CASE phase WHEN 'OPEN' THEN 'OPEN' WHEN 'ESCALATE' THEN 'ESCALATED' ELSE 'RESOLVED' END;
 UPDATE public.applications SET execution_issue_status=target,
 execution_issue_summary=CASE WHEN phase='OPEN' THEN trim(p_payload->>'note') ELSE execution_issue_summary END,
 execution_issue_resolution=CASE WHEN phase='OPEN' THEN NULL WHEN phase='RESOLVE' THEN trim(p_payload->>'note') ELSE execution_issue_resolution END,
 escalated_at=CASE WHEN phase='OPEN' THEN NULL WHEN phase='ESCALATE' THEN clock_timestamp() ELSE escalated_at END,
 escalated_by=CASE WHEN phase='OPEN' THEN NULL WHEN phase='ESCALATE' THEN p_actor ELSE escalated_by END,
 updated_at=clock_timestamp() WHERE id=a.id;
 result:=jsonb_build_object('ok',true,'application_id',a.id,'issue_status',target);
 INSERT INTO pcs.execution_issue_commands(application_id,request_id,fingerprint,result) VALUES(a.id,(p_payload->>'request_id')::uuid,fingerprint,result);
 INSERT INTO public.audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 VALUES(CASE WHEN p_actor IS NULL THEN 'ADMIN' ELSE 'STAFF' END,'execution.issue.'||lower(phase),'applications',a.id::text,
 jsonb_build_object('previous_status',a.execution_issue_status,'status',target,'request_id',p_payload->>'request_id','actor_user_id',p_actor),trim(p_payload->>'note'),'SUCCESS');
 IF phase IN ('OPEN','ESCALATE') THEN
 INSERT INTO public.notifications(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 VALUES('application.execution_issue','applications',a.id::text,'IN_APP',CASE WHEN phase='OPEN' THEN 'Проблема исполнения: ' ELSE 'Эскалация проблемы: ' END||coalesce(a.public_id,'PCS'),trim(p_payload->>'note'),'PENDING','execution-issue:'||a.id::text||':'||(p_payload->>'request_id')) ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.manage_execution_issue(jsonb,uuid) FROM PUBLIC;
