-- Reuse the canonical workflow outbox. No parallel video queue or sender.
CREATE OR REPLACE FUNCTION pcs.content_video_permissions(p_actor text,p_permissions jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT CASE WHEN p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN pcs.staff_context(p_actor::uuid)->'permissions' WHEN p_actor='pcs-manager-admin' THEN p_permissions ELSE NULL END
$fn$;
REVOKE ALL ON FUNCTION pcs.content_video_permissions(text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_video_spec_valid(p jsonb,p_platform text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE shot jsonb; total integer:=0;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('version','mode','preset','fit','shots')) OR p->'version' IS DISTINCT FROM '1'::jsonb OR p->>'mode' IS DISTINCT FROM 'TEXT_TO_VIDEO' OR coalesce(p->>'fit','') NOT IN ('contain','cover') OR jsonb_typeof(p->'shots') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF (CASE p_platform WHEN 'instagram' THEN p->>'preset' IN ('reel','story','feed') WHEN 'tiktok' THEN p->>'preset'='tiktok' WHEN 'youtube' THEN p->>'preset' IN ('shorts','landscape') WHEN 'telegram' THEN p->>'preset' IN ('landscape','story') WHEN 'website' THEN p->>'preset'='landscape' WHEN 'facebook' THEN p->>'preset' IN ('reel','story','feed','landscape') ELSE false END) IS DISTINCT FROM true THEN RETURN false;END IF;
 IF jsonb_array_length(p->'shots') NOT BETWEEN 1 AND 3 THEN RETURN false;END IF;
 FOR shot IN SELECT value FROM jsonb_array_elements(p->'shots') LOOP
  IF jsonb_typeof(shot) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(shot) k WHERE k NOT IN ('prompt','negative_prompt','seed','frames')) OR jsonb_typeof(shot->'prompt') IS DISTINCT FROM 'string' OR length(btrim(shot->>'prompt')) NOT BETWEEN 10 AND 2000 OR jsonb_typeof(shot->'negative_prompt') IS DISTINCT FROM 'string' OR length(shot->>'negative_prompt')>1000 OR jsonb_typeof(shot->'seed') IS DISTINCT FROM 'number' OR coalesce(shot->>'seed','') !~ '^\d{1,10}$' OR (shot->>'seed')::bigint>2147483647 OR jsonb_typeof(shot->'frames') IS DISTINCT FROM 'number' OR shot->'frames' IS NULL OR shot->'frames' NOT IN ('17'::jsonb,'33'::jsonb) THEN RETURN false;END IF;
  total:=total+(shot->>'frames')::integer;
 END LOOP;
 RETURN total<=99;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_video_spec_valid(jsonb,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_video_job(p public.pcs_workflow_outbox) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT p.payload||jsonb_build_object('id',p.id,'post_id',p.aggregate_id,'status',p.status,'error_code',p.last_error,'created_at',p.created_at,'completed_at',p.sent_at)
$fn$;
REVOKE ALL ON FUNCTION pcs.content_video_job(public.pcs_workflow_outbox) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_video_current(p public.pcs_workflow_outbox) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce((SELECT b.version=(p.payload->>'brand_version')::integer AND r.revision=(p.payload->>'revision')::integer AND a.status NOT IN ('PUBLICATION_SENT','PUBLICATION_REPORTED') FROM pcs.content_posts a JOIN pcs.content_brands b ON b.id=a.brand_id JOIN LATERAL(SELECT revision FROM pcs.content_revisions WHERE post_id=a.id ORDER BY revision DESC LIMIT 1)r ON true WHERE a.id=p.aggregate_id),false)
 AND coalesce((pcs.content_video_permissions(p.payload->>'created_by',p.payload->'creator_permissions') ? 'content.edit') OR (pcs.content_video_permissions(p.payload->>'created_by',p.payload->'creator_permissions') ? '*'),false)
$fn$;
REVOKE ALL ON FUNCTION pcs.content_video_current(public.pcs_workflow_outbox) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_video_action(p_action text,p jsonb,p_actor text,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; needed text; rid uuid; old pcs.content_commands; command jsonb; result jsonb; job public.pcs_workflow_outbox; post pcs.content_posts; brand pcs.content_brands; rev pcs.content_revisions; patch jsonb; stage text;
BEGIN
 permissions:=pcs.content_video_permissions(p_actor,p_permissions);needed:=CASE WHEN p_action IN ('review','resolve-unknown') THEN 'content.approve' ELSE 'content.edit' END;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?needed,false) THEN RAISE EXCEPTION 'content_video_forbidden' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','cancel','review','resolve-unknown') OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'content_video_invalid' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','post_id','expected_post_version','revision','spec','confirmed','upscale_confirmed')) OR coalesce(p->>'post_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'expected_post_version') IS DISTINCT FROM 'number' OR coalesce(p->>'expected_post_version','') !~ '^[1-9]\d{0,8}$' OR jsonb_typeof(p->'revision') IS DISTINCT FROM 'number' OR coalesce(p->>'revision','') !~ '^[1-9]\d{0,8}$' OR p->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p->'upscale_confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'content_video_invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF coalesce(p->>'job_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number' OR coalesce(p->>'expected_version','') !~ '^[1-9]\d{0,8}$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','job_id','expected_version','decision','confirmed','note','artifact_sha256','provider_checked')) THEN RAISE EXCEPTION 'content_video_invalid' USING ERRCODE='22023';END IF;
  IF p_action='cancel' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','job_id','expected_version')) THEN RAISE EXCEPTION 'content_video_invalid' USING ERRCODE='22023';END IF;
  IF p_action='review' AND (p->'confirmed' IS DISTINCT FROM 'true'::jsonb OR coalesce(p->>'decision','') NOT IN ('APPROVED','REJECTED') OR coalesce(p->>'artifact_sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'note') IS DISTINCT FROM 'string' OR length(btrim(p->>'note')) NOT BETWEEN 20 AND 4000) THEN RAISE EXCEPTION 'content_video_review_invalid' USING ERRCODE='22023';END IF;
  IF p_action='resolve-unknown' AND (p->'provider_checked' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p->'note') IS DISTINCT FROM 'string' OR length(btrim(p->>'note')) NOT BETWEEN 20 AND 4000) THEN RAISE EXCEPTION 'content_video_review_invalid' USING ERRCODE='22023';END IF;
 END IF;
 rid:=(p->>'request_id')::uuid;command:=jsonb_build_object('action','video.'||p_action,'body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));SELECT * INTO old FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF old.payload<>command THEN RAISE EXCEPTION 'content_video_request_conflict' USING ERRCODE='40001';END IF;RETURN old.result||'{"replayed":true}'::jsonb;END IF;
 IF p_action='create' THEN
  SELECT * INTO post FROM pcs.content_posts WHERE id=(p->>'post_id')::uuid FOR UPDATE;
  IF post.id IS NULL OR post.version<>(p->>'expected_post_version')::integer THEN RAISE EXCEPTION 'content_video_version_conflict' USING ERRCODE='40001';END IF;
  SELECT * INTO brand FROM pcs.content_brands WHERE id=post.brand_id FOR UPDATE;
  SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
  IF rev.post_id IS NULL OR rev.revision IS NULL OR rev.revision<>(p->>'revision')::integer OR rev.brand_version<>brand.version OR post.status IN ('PUBLICATION_SENT','PUBLICATION_REPORTED') THEN RAISE EXCEPTION 'content_video_snapshot_changed' USING ERRCODE='40001';END IF;
  IF pcs.content_video_spec_valid(p->'spec',rev.platform) IS DISTINCT FROM true THEN RAISE EXCEPTION 'content_video_spec_invalid' USING ERRCODE='22023';END IF;
  PERFORM 1 FROM public.pcs_workflow_outbox WHERE aggregate_type='CONTENT_POST' AND aggregate_id=post.id AND event_type='CONTENT_VIDEO_GENERATION' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.pcs_workflow_outbox WHERE aggregate_type='CONTENT_POST' AND aggregate_id=post.id AND event_type='CONTENT_VIDEO_GENERATION' AND (status IN ('PENDING','PROCESSING') OR last_error='GPU_LAUNCH_UNKNOWN')) THEN RAISE EXCEPTION 'content_video_live_job_exists' USING ERRCODE='40001';END IF;
  INSERT INTO public.pcs_workflow_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,status,next_attempt_at,payload) VALUES('CONTENT_POST',post.id,'CONTENT_VIDEO_GENERATION','content-video:'||rid::text,'PENDING',clock_timestamp(),jsonb_build_object('version',1,'stage','QUEUED','revision',rev.revision,'brand_id',brand.id,'brand_version',brand.version,'created_by',p_actor,'creator_permissions',permissions,'spec',p->'spec','source_width',320,'source_height',256,'source_fps',8,'inference_steps',30,'review_status','PENDING','manual_review_required',true,'snapshot',jsonb_build_object('brand_name',brand.name,'brand_guidelines',brand.guidelines,'title',rev.title,'body',rev.body,'platform',rev.platform,'language',rev.language,'source_facts',rev.source_facts,'source_url',rev.source_url))) RETURNING * INTO job;
 ELSE
  SELECT * INTO job FROM public.pcs_workflow_outbox WHERE id=(p->>'job_id')::uuid AND aggregate_type='CONTENT_POST' AND event_type='CONTENT_VIDEO_GENERATION' FOR UPDATE;
  IF job.id IS NULL OR (job.payload->>'version')::integer<>(p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_video_version_conflict' USING ERRCODE='40001';END IF;
  stage:=job.payload->>'stage';
  IF p_action='cancel' THEN
   IF stage NOT IN ('QUEUED','PREPARING','GENERATING','POST_PROCESSING','QA') THEN RAISE EXCEPTION 'content_video_job_locked' USING ERRCODE='40001';END IF;
   patch:=jsonb_build_object('stage','CANCELLED','cancellation_note','Generation already accepted by the provider may continue; output will not be used.');
   UPDATE public.pcs_workflow_outbox SET status='CANCELLED',last_error=CASE WHEN stage='GENERATING' THEN 'GPU_LAUNCH_UNKNOWN' ELSE 'OPERATOR_CANCELLED' END WHERE id=job.id;
  ELSIF p_action='review' THEN
   IF stage<>'READY' OR job.payload#>>'{artifact,sha256}' IS DISTINCT FROM p->>'artifact_sha256' OR NOT pcs.content_video_current(job) THEN RAISE EXCEPTION 'content_video_review_stale' USING ERRCODE='40001';END IF;
   patch:=jsonb_build_object('review_status',p->>'decision','review',jsonb_build_object('actor',p_actor,'decision',p->>'decision','note',btrim(p->>'note'),'artifact_sha256',p->>'artifact_sha256','checked_at',clock_timestamp()));
  ELSE
   IF stage NOT IN ('FAILED','CANCELLED') OR job.last_error IS DISTINCT FROM 'GPU_LAUNCH_UNKNOWN' THEN RAISE EXCEPTION 'content_video_review_stale' USING ERRCODE='40001';END IF;
   patch:=jsonb_build_object('launch_review',jsonb_build_object('actor',p_actor,'provider_checked',true,'note',btrim(p->>'note'),'checked_at',clock_timestamp()));
   UPDATE public.pcs_workflow_outbox SET last_error='GPU_LAUNCH_RESOLVED' WHERE id=job.id;
  END IF;
  UPDATE public.pcs_workflow_outbox SET payload=payload||patch||jsonb_build_object('version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id RETURNING * INTO job;
 END IF;
 result:=jsonb_build_object('ok',true,'job',pcs.content_video_job(job));
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.video.'||p_action,'content',job.aggregate_id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'job_id',job.id,'stage',job.payload->'stage','version',job.payload->'version'),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,command,result);RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_video_action(text,jsonb,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_video_worker(p_action text,p jsonb,p_worker text,p_workflow_sha text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE rid uuid; old pcs.content_commands; command jsonb; result jsonb; job public.pcs_workflow_outbox; patch jsonb; stage text; target text; attempt integer:=0; receipt jsonb; artifact jsonb; dims integer[]; error_code text;
BEGIN
 IF coalesce(p_worker,'') !~ '^github:[1-9]\d{3,19}:[1-9]\d{0,5}$' OR coalesce(p_workflow_sha,'') !~ '^[a-f0-9]{40}$' THEN RAISE EXCEPTION 'content_video_worker_forbidden' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('claim','read','progress','complete','fail') OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','job_id','claim_id','expected_version','stage','provider_receipt','artifact','error_code')) THEN RAISE EXCEPTION 'content_video_worker_invalid' USING ERRCODE='22023';END IF;
 IF p_action='claim' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>'request_id') THEN RAISE EXCEPTION 'content_video_worker_invalid' USING ERRCODE='22023';END IF;
 IF p_action<>'claim' AND (coalesce(p->>'job_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'claim_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number' OR coalesce(p->>'expected_version','') !~ '^[1-9]\d{0,8}$') THEN RAISE EXCEPTION 'content_video_worker_invalid' USING ERRCODE='22023';END IF;
 rid:=(p->>'request_id')::uuid;command:=jsonb_build_object('action','video.worker.'||p_action,'body',p,'worker',p_worker,'workflow_sha',p_workflow_sha);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));SELECT * INTO old FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF old.payload<>command THEN RAISE EXCEPTION 'content_video_request_conflict' USING ERRCODE='40001';END IF;RETURN old.result||'{"replayed":true}'::jsonb;END IF;
 IF p_action='claim' THEN
  -- Expired workers are never requeued: an upstream kernel can outlive Actions.
  FOR job IN SELECT * FROM public.pcs_workflow_outbox WHERE aggregate_type='CONTENT_POST' AND event_type='CONTENT_VIDEO_GENERATION' AND status='PROCESSING' AND coalesce((payload->>'updated_at')::timestamptz,created_at)<clock_timestamp()-interval '185 minutes' ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
   error_code:=CASE WHEN job.payload->>'stage'='GENERATING' THEN 'GPU_LAUNCH_UNKNOWN' ELSE 'WORKER_INTERRUPTED' END;
   UPDATE public.pcs_workflow_outbox SET status='FAILED',last_error=error_code,payload=payload||jsonb_build_object('stage','FAILED','version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id;
   INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('SYSTEM','content.video.worker.expired','content',job.aggregate_id::text,jsonb_build_object('job_id',job.id,'prior_worker',job.payload->'worker_id','reason',error_code),'SUCCESS');
  END LOOP;
  job:=NULL;
  -- A restarted request in the same verified Actions attempt owns its existing job.
  SELECT * INTO job FROM public.pcs_workflow_outbox WHERE aggregate_type='CONTENT_POST' AND event_type='CONTENT_VIDEO_GENERATION' AND status='PROCESSING' AND payload->>'worker_id'=p_worker AND payload->>'workflow_sha'=p_workflow_sha ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF job.id IS NOT NULL AND NOT pcs.content_video_current(job) THEN
   UPDATE public.pcs_workflow_outbox SET status='CANCELLED',last_error=CASE WHEN payload->>'stage'='GENERATING' THEN 'GPU_LAUNCH_UNKNOWN' ELSE 'SNAPSHOT_OR_PERMISSION_CHANGED' END,payload=payload||jsonb_build_object('cancellation_reason','SNAPSHOT_OR_PERMISSION_CHANGED','stage','CANCELLED','version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id;
   INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('SYSTEM','content.video.worker.cancelled','content',job.aggregate_id::text,jsonb_build_object('job_id',job.id,'worker',p_worker,'reason','SNAPSHOT_OR_PERMISSION_CHANGED'),'SUCCESS');
   job:=NULL;
  END IF;
  IF job.id IS NULL THEN
   LOOP
    attempt:=attempt+1;IF attempt>20 THEN EXIT;END IF;
    SELECT * INTO job FROM public.pcs_workflow_outbox WHERE aggregate_type='CONTENT_POST' AND event_type='CONTENT_VIDEO_GENERATION' AND status='PENDING' AND next_attempt_at<=clock_timestamp() ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF job.id IS NULL THEN EXIT;END IF;
    IF pcs.content_video_current(job) THEN EXIT;END IF;
    UPDATE public.pcs_workflow_outbox SET status='CANCELLED',last_error=CASE WHEN payload->>'stage'='GENERATING' THEN 'GPU_LAUNCH_UNKNOWN' ELSE 'SNAPSHOT_OR_PERMISSION_CHANGED' END,payload=payload||jsonb_build_object('cancellation_reason','SNAPSHOT_OR_PERMISSION_CHANGED','stage','CANCELLED','version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id;
    INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('SYSTEM','content.video.worker.cancelled','content',job.aggregate_id::text,jsonb_build_object('job_id',job.id,'worker',p_worker,'reason','SNAPSHOT_OR_PERMISSION_CHANGED'),'SUCCESS');
    job:=NULL;
   END LOOP;
   IF job.id IS NOT NULL THEN
    UPDATE public.pcs_workflow_outbox SET status='PROCESSING',attempts=attempts+1,payload=payload||jsonb_build_object('stage','PREPARING','claim_id',gen_random_uuid(),'worker_id',p_worker,'workflow_sha',p_workflow_sha,'version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id RETURNING * INTO job;
   END IF;
  END IF;
 ELSE
  SELECT * INTO job FROM public.pcs_workflow_outbox WHERE id=(p->>'job_id')::uuid AND aggregate_type='CONTENT_POST' AND event_type='CONTENT_VIDEO_GENERATION' FOR UPDATE;
  IF job.id IS NULL OR job.payload->>'worker_id' IS DISTINCT FROM p_worker OR job.payload->>'workflow_sha' IS DISTINCT FROM p_workflow_sha OR job.payload->>'claim_id' IS DISTINCT FROM p->>'claim_id' THEN RAISE EXCEPTION 'content_video_worker_forbidden' USING ERRCODE='42501';END IF;
  IF (job.payload->>'version')::integer<>(p->>'expected_version')::integer AND p_action<>'read' THEN RAISE EXCEPTION 'content_video_version_conflict' USING ERRCODE='40001';END IF;
  IF (job.status<>'PROCESSING' OR NOT pcs.content_video_current(job)) THEN
   IF job.status='PROCESSING' THEN UPDATE public.pcs_workflow_outbox SET status='CANCELLED',last_error=CASE WHEN payload->>'stage'='GENERATING' THEN 'GPU_LAUNCH_UNKNOWN' ELSE 'SNAPSHOT_OR_PERMISSION_CHANGED' END,payload=payload||jsonb_build_object('cancellation_reason','SNAPSHOT_OR_PERMISSION_CHANGED','stage','CANCELLED','version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id RETURNING * INTO job;
    INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('SYSTEM','content.video.worker.cancelled','content',job.aggregate_id::text,jsonb_build_object('job_id',job.id,'worker',p_worker,'reason',job.last_error),'SUCCESS');END IF;
   result:=jsonb_build_object('ok',true,'stopped',true,'job',pcs.content_video_job(job));
  ELSIF p_action='progress' THEN
   stage:=job.payload->>'stage';target:=p->>'stage';receipt:=p->'provider_receipt';
   IF ((stage='PREPARING' AND target='GENERATING' AND receipt IS NULL) OR (stage='GENERATING' AND target='GENERATING' AND receipt IS NOT NULL AND NOT job.payload?'provider_receipt') OR (stage='GENERATING' AND target='POST_PROCESSING' AND job.payload?'provider_receipt' AND (receipt IS NULL OR receipt=job.payload->'provider_receipt')) OR (stage='POST_PROCESSING' AND target='QA' AND receipt IS NULL)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'content_video_stage_invalid' USING ERRCODE='40001';END IF;
   IF receipt IS NOT NULL AND (jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(receipt) k WHERE k NOT IN ('kernel','version','ref','run_id')) OR receipt->>'kernel' IS DISTINCT FROM 'tatyanathai/pcs-legat-ai-avatar-pipeline' OR jsonb_typeof(receipt->'version') IS DISTINCT FROM 'number' OR coalesce(receipt->>'version','') !~ '^[1-9]\d{0,8}$' OR receipt->>'ref' IS DISTINCT FROM (receipt->>'kernel')||'/'||(receipt->>'version') OR receipt->>'run_id' IS DISTINCT FROM p->>'claim_id') THEN RAISE EXCEPTION 'content_video_provider_receipt_invalid' USING ERRCODE='22023';END IF;
   patch:=jsonb_build_object('stage',target);IF receipt IS NOT NULL THEN patch:=patch||jsonb_build_object('provider_receipt',receipt);END IF;
  ELSIF p_action='complete' THEN
   artifact:=p->'artifact';dims:=CASE job.payload#>>'{spec,preset}' WHEN 'feed' THEN ARRAY[1080,1350] WHEN 'pinterest' THEN ARRAY[1000,1500] WHEN 'landscape' THEN ARRAY[1280,720] ELSE ARRAY[1080,1920] END;
   IF job.payload->>'stage'<>'QA' OR jsonb_typeof(artifact) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(artifact) k WHERE k NOT IN ('bucket','path','sha256','bytes','width','height','fps','frames','duration_seconds','decode_verified','codec','technical_qa','manual_review_required','cover','source_model','model_revision','manifest_sha256'))
    OR artifact->>'bucket' IS DISTINCT FROM 'pcs-content-video' OR artifact->>'path' IS DISTINCT FROM 'jobs/'||job.id::text||'/'||(job.payload->>'claim_id')||'/final.mp4'
    OR coalesce(artifact->>'sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(artifact->'bytes') IS DISTINCT FROM 'number' OR coalesce(artifact->>'bytes','') !~ '^\d{1,8}$' OR (artifact->>'bytes')::bigint NOT BETWEEN 1024 AND 26214400
    OR artifact->'width' IS DISTINCT FROM to_jsonb(dims[1]) OR artifact->'height' IS DISTINCT FROM to_jsonb(dims[2]) OR artifact->'manual_review_required' IS DISTINCT FROM 'true'::jsonb OR artifact->'decode_verified' IS DISTINCT FROM 'true'::jsonb OR artifact->>'codec' IS DISTINCT FROM 'h264' OR artifact->>'technical_qa' IS DISTINCT FROM 'PASSED'
    OR artifact->>'source_model' IS DISTINCT FROM 'Lightricks/LTX-Video-0.9.5' OR artifact->>'model_revision' IS DISTINCT FROM 'e58e28c39631af4d1468ee57a853764e11c1d37e' OR coalesce(artifact->>'manifest_sha256','') !~ '^[a-f0-9]{64}$'
    OR artifact->'fps' IS DISTINCT FROM '24'::jsonb OR jsonb_typeof(artifact->'frames') IS DISTINCT FROM 'number' OR coalesce(artifact->>'frames','') !~ '^\d{1,4}$' OR (artifact->>'frames')::integer NOT BETWEEN 1 AND 1500
    OR jsonb_typeof(artifact->'duration_seconds') IS DISTINCT FROM 'number' OR coalesce(artifact->>'duration_seconds','') !~ '^\d{1,2}(\.\d{1,8})?$' OR (artifact->>'duration_seconds')::numeric NOT BETWEEN 0.1 AND 15
    OR (artifact->>'frames')::integer<>(SELECT sum((value->>'frames')::integer)*3 FROM jsonb_array_elements(job.payload#>'{spec,shots}')) OR abs((artifact->>'duration_seconds')::numeric-(SELECT sum((value->>'frames')::numeric)/8 FROM jsonb_array_elements(job.payload#>'{spec,shots}')))>0.000001
    OR jsonb_typeof(artifact->'cover') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(artifact->'cover') k WHERE k NOT IN ('bucket','path','sha256','bytes'))
    OR artifact#>>'{cover,bucket}' IS DISTINCT FROM 'pcs-content-video' OR artifact#>>'{cover,path}' IS DISTINCT FROM 'jobs/'||job.id::text||'/'||(job.payload->>'claim_id')||'/cover.png' OR coalesce(artifact#>>'{cover,sha256}','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(artifact#>'{cover,bytes}') IS DISTINCT FROM 'number' OR coalesce(artifact#>>'{cover,bytes}','') !~ '^\d{1,8}$' OR (artifact#>>'{cover,bytes}')::integer NOT BETWEEN 8 AND 2097152
    THEN RAISE EXCEPTION 'content_video_artifact_invalid' USING ERRCODE='22023';END IF;
   patch:=jsonb_build_object('stage','READY','artifact',artifact,'manual_review_required',true,'review_status','PENDING');
   UPDATE public.pcs_workflow_outbox SET status='SENT',sent_at=clock_timestamp(),last_error=NULL WHERE id=job.id;
  ELSIF p_action='fail' THEN
   error_code:=p->>'error_code';
   IF error_code NOT IN ('VIDEO_PREPARATION_FAILED','GPU_LAUNCH_UNKNOWN','VIDEO_GENERATION_FAILED','VIDEO_POSTPROCESS_FAILED','VIDEO_UPLOAD_FAILED','WORKER_INTERRUPTED','QA_FAILED','PROVIDER_UNAVAILABLE') OR error_code IS NULL THEN RAISE EXCEPTION 'content_video_error_invalid' USING ERRCODE='22023';END IF;
   patch:=jsonb_build_object('stage','FAILED','failure_cause',error_code);
   IF job.payload->>'stage'='GENERATING' THEN error_code:='GPU_LAUNCH_UNKNOWN';END IF;
   UPDATE public.pcs_workflow_outbox SET status='FAILED',last_error=error_code WHERE id=job.id;
  END IF;
  IF patch IS NOT NULL THEN UPDATE public.pcs_workflow_outbox SET payload=payload||patch||jsonb_build_object('version',(payload->>'version')::integer+1,'updated_at',clock_timestamp()) WHERE id=job.id RETURNING * INTO job;END IF;
 END IF;
 result:=coalesce(result,jsonb_build_object('ok',true,'job',CASE WHEN job.id IS NULL THEN NULL ELSE pcs.content_video_job(job) END));
 IF p_action<>'read' THEN
  INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('SYSTEM','content.video.worker.'||p_action,'content',coalesce(job.aggregate_id::text,p_worker),jsonb_build_object('worker',p_worker,'workflow_sha',p_workflow_sha,'request_id',rid,'job_id',job.id,'stage',job.payload->'stage'),'SUCCESS');
  INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,command,result);
 END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_video_worker(text,jsonb,text,text) FROM PUBLIC;
