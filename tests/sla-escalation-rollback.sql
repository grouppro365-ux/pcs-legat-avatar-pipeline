DECLARE a uuid:=gen_random_uuid(); reviewed uuid:=gen_random_uuid(); terminal uuid:=gen_random_uuid(); future uuid:=gen_random_uuid(); undated uuid:=gen_random_uuid(); r record; before_count int;
BEGIN
 CREATE TEMP TABLE applications(LIKE public.applications INCLUDING DEFAULTS INCLUDING INDEXES);
 CREATE TEMP TABLE notifications(LIKE public.notifications INCLUDING DEFAULTS INCLUDING INDEXES);
 CREATE TEMP TABLE audit_events(LIKE public.audit_events INCLUDING DEFAULTS INCLUDING INDEXES);
 INSERT INTO applications(id,public_id,category,operational_status,sla_due_at,human_review_required) VALUES
 (a,'QA-a','general','NEW',now()-interval '1 hour',false),(reviewed,'QA-b','general','NEW',now()-interval '2 hours',true),
 (terminal,'QA-c','general','COMPLETED',now()-interval '1 hour',false),(future,'QA-d','general','NEW',now()+interval '1 hour',false),(undated,'QA-e','general','NEW',null,false);
 EXECUTE $sla$__SLA__$sla$ INTO r USING ARRAY['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'];
 IF r.created<>2 OR (SELECT count(*) FROM notifications)<>2 OR (SELECT count(*) FROM audit_events)<>2 THEN RAISE EXCEPTION 'QA SLA incomplete atomic receipt';END IF;
 IF NOT (SELECT human_review_required FROM applications WHERE id=a) OR (SELECT human_review_required FROM applications WHERE id=terminal) THEN RAISE EXCEPTION 'QA wrong review flag';END IF;
 EXECUTE $sla$__SLA__$sla$ INTO r USING ARRAY['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'];
 IF r.created<>0 OR (SELECT count(*) FROM audit_events)<>2 THEN RAISE EXCEPTION 'QA SLA duplicate';END IF;
 UPDATE applications SET sla_due_at=now()-interval '3 hours' WHERE id=a;
 EXECUTE $sla$__SLA__$sla$ INTO r USING ARRAY['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'];
 IF r.created<>1 THEN RAISE EXCEPTION 'QA changed deadline not escalated';END IF;
 IF EXISTS(SELECT 1 FROM notifications WHERE channel<>'IN_APP') THEN RAISE EXCEPTION 'QA external escalation';END IF;
END;
