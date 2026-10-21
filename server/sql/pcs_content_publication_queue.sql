-- Durable text publication jobs within the canonical content workflow.
-- This migration performs no Telegram requests and starts no scheduler.
ALTER TABLE pcs.content_posts ADD COLUMN IF NOT EXISTS publication_target_id uuid REFERENCES pcs.content_targets(id);
CREATE TABLE IF NOT EXISTS pcs.content_publication_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid NOT NULL,revision integer NOT NULL,
 brand_id uuid NOT NULL REFERENCES pcs.content_brands(id),brand_version integer NOT NULL,
 target_id uuid NOT NULL REFERENCES pcs.content_targets(id),target_version integer NOT NULL,
 username text NOT NULL,chat_id text NOT NULL,bot_id text NOT NULL,body text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','SENDING','SENT','REJECTED','UNKNOWN','CANCELLED','BLOCKED')),
 scheduled_at timestamptz NOT NULL,claim_id uuid,claimed_at timestamptz,completed_at timestamptz,
 provider_receipt jsonb,public_url text,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(post_id,revision),FOREIGN KEY(post_id,revision) REFERENCES pcs.content_revisions(post_id,revision)
);
CREATE INDEX IF NOT EXISTS content_publication_jobs_due ON pcs.content_publication_jobs(scheduled_at,id) WHERE state='QUEUED';
REVOKE ALL ON pcs.content_publication_jobs FROM PUBLIC;
ALTER TABLE pcs.content_posts DROP CONSTRAINT IF EXISTS content_posts_status_check;
ALTER TABLE pcs.content_posts ADD CONSTRAINT content_posts_status_check CHECK(status IN ('DRAFT','REVIEW','APPROVED','READY','PUBLICATION_REPORTED','PUBLICATION_SENT'));
CREATE OR REPLACE FUNCTION pcs.content_publication_action(p_action text,p jsonb,p_actor text,p_permissions jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; rid uuid; payload jsonb; prior pcs.content_commands; post pcs.content_posts; rev pcs.content_revisions; brand pcs.content_brands; target pcs.content_targets; job pcs.content_publication_jobs; receipt jsonb; prior_job jsonb;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501';END IF;
 IF p_action NOT IN ('schedule','cancel') OR p_action IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number' OR coalesce(p->>'expected_version','') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'content_publication_invalid' USING ERRCODE='22023';END IF;
 IF p_action='schedule' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','id','expected_version','target_id','target_version','scheduled_at','publication_confirmed')) OR p->'publication_confirmed' IS DISTINCT FROM 'true'::jsonb OR coalesce(p->>'target_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'target_version') IS DISTINCT FROM 'number' OR coalesce(p->>'target_version','') !~ '^[1-9][0-9]{0,8}$' OR coalesce(p->>'scheduled_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'content_publication_invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','id','expected_version','job_id')) OR coalesce(p->>'job_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'content_publication_invalid' USING ERRCODE='22023';END IF;
 END IF;
 rid:=(p->>'request_id')::uuid;payload:=jsonb_build_object('action','publication.'||p_action,'body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));SELECT * INTO prior FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF prior.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001';END IF;RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 SELECT * INTO post FROM pcs.content_posts WHERE id=(p->>'id')::uuid FOR UPDATE;
 IF NOT FOUND OR post.version IS DISTINCT FROM (p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001';END IF;
 SELECT * INTO brand FROM pcs.content_brands WHERE id=post.brand_id FOR UPDATE;
 IF p_action='schedule' THEN
  SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO target FROM pcs.content_targets WHERE id=(p->>'target_id')::uuid FOR UPDATE;
  IF target.id IS NULL OR target.brand_id<>post.brand_id OR NOT target.enabled OR target.version IS DISTINCT FROM (p->>'target_version')::integer OR target.verified_at IS NULL THEN RAISE EXCEPTION 'content_publication_target_changed' USING ERRCODE='40001';END IF;
  SELECT * INTO job FROM pcs.content_publication_jobs WHERE post_id=post.id AND revision=rev.revision FOR UPDATE;prior_job:=to_jsonb(job);
  IF NOT (post.status='APPROVED' OR (post.status='READY' AND job.state IN ('REJECTED','BLOCKED'))) OR post.approved_revision IS DISTINCT FROM rev.revision OR rev.brand_version<>brand.version OR rev.platform<>'telegram' OR length(rev.body)>4096 OR (p->>'scheduled_at')::timestamptz<=clock_timestamp() OR NOT isfinite((p->>'scheduled_at')::timestamptz) THEN RAISE EXCEPTION 'content_publication_approval_required' USING ERRCODE='22023';END IF;
  IF job.id IS NOT NULL AND job.state NOT IN ('CANCELLED','REJECTED','BLOCKED') THEN RAISE EXCEPTION 'content_publication_job_locked' USING ERRCODE='40001';END IF;
  IF job.id IS NULL THEN
   INSERT INTO pcs.content_publication_jobs(post_id,revision,brand_id,brand_version,target_id,target_version,username,chat_id,bot_id,body,scheduled_at) VALUES(post.id,rev.revision,post.brand_id,brand.version,target.id,target.version,target.username,target.chat_id,target.bot_id,rev.body,(p->>'scheduled_at')::timestamptz) RETURNING * INTO job;
  ELSE
   UPDATE pcs.content_publication_jobs SET brand_version=brand.version,target_id=target.id,target_version=target.version,username=target.username,chat_id=target.chat_id,bot_id=target.bot_id,body=rev.body,scheduled_at=(p->>'scheduled_at')::timestamptz,state='QUEUED',claim_id=NULL,claimed_at=NULL,completed_at=NULL,provider_receipt=NULL,public_url=NULL,last_error=NULL,updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  END IF;
  UPDATE pcs.content_posts SET status='READY',scheduled_at=job.scheduled_at,publication_target_id=target.id,version=version+1,updated_at=clock_timestamp() WHERE id=post.id RETURNING * INTO post;
 ELSE
  SELECT * INTO job FROM pcs.content_publication_jobs WHERE id=(p->>'job_id')::uuid AND post_id=post.id FOR UPDATE;prior_job:=to_jsonb(job);
  IF job.id IS NULL OR job.state<>'QUEUED' OR post.status<>'READY' THEN RAISE EXCEPTION 'content_publication_job_locked' USING ERRCODE='40001';END IF;
  UPDATE pcs.content_publication_jobs SET state='CANCELLED',completed_at=clock_timestamp(),last_error='operator_cancelled',updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  UPDATE pcs.content_posts SET status='APPROVED',scheduled_at=NULL,publication_target_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=post.id RETURNING * INTO post;
 END IF;
 receipt:=jsonb_build_object('ok',true,'id',post.id,'version',post.version,'status',post.status,'job',to_jsonb(job));
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.publication.'||p_action,'content',post.id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'version',post.version,'before_job',prior_job,'job',to_jsonb(job)),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,receipt);RETURN receipt;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_publication_action(text,jsonb,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_claim_publication() RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE post pcs.content_posts; job pcs.content_publication_jobs; target pcs.content_targets; rev pcs.content_revisions; brand_version integer; reason text;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='pcs.content_claim_publication()'::regprocedure)) THEN RAISE EXCEPTION 'content_internal_only' USING ERRCODE='42501';END IF;
 SELECT p.* INTO post FROM pcs.content_posts p WHERE EXISTS(SELECT 1 FROM pcs.content_publication_jobs j WHERE j.post_id=p.id AND j.state='QUEUED' AND j.scheduled_at<=clock_timestamp()) ORDER BY (SELECT min(j.scheduled_at) FROM pcs.content_publication_jobs j WHERE j.post_id=p.id AND j.state='QUEUED'),p.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL);END IF;
 SELECT * INTO job FROM pcs.content_publication_jobs WHERE post_id=post.id AND state='QUEUED' AND scheduled_at<=clock_timestamp() ORDER BY scheduled_at,id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'job',NULL);END IF;
 SELECT version INTO brand_version FROM pcs.content_brands WHERE id=post.brand_id FOR UPDATE;
 SELECT * INTO target FROM pcs.content_targets WHERE id=job.target_id FOR UPDATE;
 SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
 IF post.status<>'READY' OR post.publication_target_id IS DISTINCT FROM job.target_id THEN reason:='post_not_ready';
 ELSIF rev.revision IS DISTINCT FROM job.revision OR rev.brand_version IS DISTINCT FROM job.brand_version OR brand_version IS DISTINCT FROM job.brand_version OR post.approved_revision IS DISTINCT FROM job.revision OR rev.platform<>'telegram' OR rev.body<>job.body THEN reason:='approval_changed';
 ELSIF target.id IS NULL OR NOT target.enabled OR target.brand_id<>job.brand_id OR target.version<>job.target_version OR target.username<>job.username OR target.chat_id<>job.chat_id OR target.bot_id<>job.bot_id OR target.verified_at IS NULL THEN reason:='target_changed';END IF;
 IF reason IS NOT NULL THEN
  UPDATE pcs.content_publication_jobs SET state='BLOCKED',last_error=reason,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
  -- A definitely unsent job returns to operator approval controls.
  UPDATE pcs.content_posts SET status='APPROVED',scheduled_at=NULL,publication_target_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=post.id AND status='READY';
 ELSE
  UPDATE pcs.content_publication_jobs SET state='SENDING',claim_id=gen_random_uuid(),claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('ADMIN','content.publication.claim','content',post.id::text,jsonb_build_object('job_id',job.id,'state',job.state,'claim_id',job.claim_id,'reason',reason),'SUCCESS');
 RETURN jsonb_build_object('ok',true,'job',CASE WHEN job.state='SENDING' THEN to_jsonb(job) ELSE NULL END,'blocked_job_id',CASE WHEN job.state='BLOCKED' THEN job.id ELSE NULL END);
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_claim_publication() FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_complete_publication(p_job uuid,p_claim uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE post pcs.content_posts; job pcs.content_publication_jobs; pid uuid; receipt jsonb; outcome text; reason text;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='pcs.content_complete_publication(uuid,uuid,jsonb)'::regprocedure)) THEN RAISE EXCEPTION 'content_internal_only' USING ERRCODE='42501';END IF;
 SELECT post_id INTO pid FROM pcs.content_publication_jobs WHERE id=p_job;
 IF NOT FOUND OR p_claim IS NULL THEN RAISE EXCEPTION 'content_publication_claim_conflict' USING ERRCODE='40001';END IF;
 SELECT * INTO post FROM pcs.content_posts WHERE id=pid FOR UPDATE;SELECT * INTO job FROM pcs.content_publication_jobs WHERE id=p_job FOR UPDATE;
 IF job.claim_id IS DISTINCT FROM p_claim THEN RAISE EXCEPTION 'content_publication_claim_conflict' USING ERRCODE='40001';END IF;
 IF job.state IN ('SENT','REJECTED','UNKNOWN') THEN IF job.provider_receipt IS DISTINCT FROM p_result THEN RAISE EXCEPTION 'content_publication_receipt_conflict' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('ok',true,'job',to_jsonb(job),'replayed',true);END IF;
 IF job.state<>'SENDING' OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR coalesce(p_result->>'outcome','') NOT IN ('SENT','REJECTED','UNKNOWN') THEN RAISE EXCEPTION 'content_publication_receipt_invalid' USING ERRCODE='22023';END IF;
 outcome:=p_result->>'outcome';reason:=p_result->>'reason';
 IF outcome='SENT' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN ('outcome','chat_id','text','message_id','date')) OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>5 OR jsonb_typeof(p_result->'chat_id') IS DISTINCT FROM 'string' OR p_result->>'chat_id' IS DISTINCT FROM job.chat_id OR jsonb_typeof(p_result->'text') IS DISTINCT FROM 'string' OR p_result->>'text' IS DISTINCT FROM job.body OR jsonb_typeof(p_result->'message_id') IS DISTINCT FROM 'string' OR coalesce(p_result->>'message_id','') !~ '^[1-9][0-9]{0,14}$' OR jsonb_typeof(p_result->'date') IS DISTINCT FROM 'number' OR coalesce(p_result->>'date','') !~ '^[1-9][0-9]{0,15}$' OR (p_result->>'date')::numeric>9007199254740991 OR (p_result->>'date')::numeric>extract(epoch FROM clock_timestamp())+300 OR (p_result->>'date')::numeric<extract(epoch FROM job.claimed_at)-300 THEN RAISE EXCEPTION 'content_publication_receipt_invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN ('outcome','reason')) OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>2 OR (outcome='REJECTED' AND coalesce(reason,'') NOT IN ('before_send_rejected','target_preflight_failed','provider_rejected')) OR (outcome='UNKNOWN' AND coalesce(reason,'') NOT IN ('transport_unknown','receipt_invalid')) THEN RAISE EXCEPTION 'content_publication_receipt_invalid' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE pcs.content_publication_jobs SET state=outcome,provider_receipt=p_result,public_url=CASE WHEN outcome='SENT' THEN 'https://t.me/'||username||'/'||(p_result->>'message_id') ELSE NULL END,last_error=reason,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job.id RETURNING * INTO job;
 IF outcome='SENT' THEN UPDATE pcs.content_posts SET status='PUBLICATION_SENT',publication_url=job.public_url,publication_note='Telegram accepted the exact approved text; independent public text observation is separate.',version=version+1,updated_at=clock_timestamp() WHERE id=post.id;
 ELSIF outcome='REJECTED' THEN UPDATE pcs.content_posts SET status='APPROVED',scheduled_at=NULL,publication_target_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=post.id;END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('ADMIN','content.publication.complete','content',post.id::text,jsonb_build_object('job_id',job.id,'claim_id',job.claim_id,'outcome',outcome,'reason',reason,'receipt',p_result),'SUCCESS');
 RETURN jsonb_build_object('ok',true,'job',to_jsonb(job));
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_complete_publication(uuid,uuid,jsonb) FROM PUBLIC;
