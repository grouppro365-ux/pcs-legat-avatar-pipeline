-- Add an observation to the canonical content record; never publish or change its status.
ALTER TABLE pcs.content_posts ADD COLUMN IF NOT EXISTS publication_verification jsonb;
CREATE OR REPLACE FUNCTION pcs.content_verify_publication(p jsonb,p_actor text,p_permissions jsonb,p_observation jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; rid uuid; payload jsonb; prior pcs.content_commands; post pcs.content_posts; rev pcs.content_revisions; evidence jsonb; result jsonb; canonical_url text;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','id','expected_version')) OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'expected_version','') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'content_verification_invalid' USING ERRCODE='22023';END IF;
 rid:=(p->>'request_id')::uuid;payload:=jsonb_build_object('action','verify-publication','body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));
 SELECT * INTO prior FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF prior.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001';END IF;RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 SELECT * INTO post FROM pcs.content_posts WHERE id=(p->>'id')::uuid FOR UPDATE;
 IF NOT FOUND OR post.version IS DISTINCT FROM (p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001';END IF;
 SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
 IF post.status NOT IN ('PUBLICATION_REPORTED','PUBLICATION_SENT') OR rev.platform<>'telegram' OR post.approved_revision IS DISTINCT FROM rev.revision THEN RAISE EXCEPTION 'content_verification_requires_reported_current_approval' USING ERRCODE='22023';END IF;
 IF p_observation IS NULL THEN RETURN jsonb_build_object('ok',true,'verification_required',true,'snapshot',jsonb_build_object('body',rev.body,'publication_url',post.publication_url));END IF;
 canonical_url:=regexp_replace(regexp_replace(lower(post.publication_url),'^https://t[.]me/s/','https://t.me/'),'/$','');
 IF jsonb_typeof(p_observation) IS DISTINCT FROM 'object' OR p_observation->>'method' IS DISTINCT FROM 'public_telegram_text_v1' OR coalesce(p_observation->>'outcome','') NOT IN ('TEXT_MATCH','TEXT_MISMATCH','UNREADABLE') OR coalesce(p_observation->>'reason','') NOT IN ('exact_text_observed','different_text_observed','redirect_refused','page_unavailable','fetch_timeout','page_too_large','ambiguous_message','message_missing','text_unreadable') OR p_observation->>'publication_url' IS DISTINCT FROM canonical_url OR canonical_url !~ '^https://t[.]me/[a-z][a-z0-9_]{3,31}/[1-9][0-9]{0,14}$' OR coalesce(p_observation->>'expected_sha256','') !~ '^[a-f0-9]{64}$' OR canonical_url IS DISTINCT FROM 'https://t.me/'||(p_observation->>'username')||'/'||(p_observation->>'message_id') OR p_observation->>'fetch_url' IS DISTINCT FROM 'https://t.me/s/'||(p_observation->>'username')||'?before='||((p_observation->>'message_id')::bigint+1)::text THEN RAISE EXCEPTION 'content_verification_invalid' USING ERRCODE='22023';END IF;
 IF p_observation->>'outcome'='UNREADABLE' THEN
  IF p_observation->>'observed_sha256' IS NOT NULL OR p_observation->>'published_at' IS NOT NULL OR p_observation->>'reason' IN ('exact_text_observed','different_text_observed') THEN RAISE EXCEPTION 'content_verification_invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF coalesce(p_observation->>'observed_sha256','') !~ '^[a-f0-9]{64}$' OR nullif(p_observation->>'published_at','') IS NULL OR (p_observation->>'published_at')::timestamptz IS NULL OR (p_observation->>'outcome'='TEXT_MATCH' AND (p_observation->>'reason'<>'exact_text_observed' OR p_observation->>'observed_sha256'<>p_observation->>'expected_sha256')) OR (p_observation->>'outcome'='TEXT_MISMATCH' AND (p_observation->>'reason'<>'different_text_observed' OR p_observation->>'observed_sha256'=p_observation->>'expected_sha256')) THEN RAISE EXCEPTION 'content_verification_invalid' USING ERRCODE='22023';END IF;
 END IF;
 evidence:=jsonb_build_object('method',p_observation->>'method','outcome',p_observation->>'outcome','reason',p_observation->>'reason','publication_url',canonical_url,'fetch_url',p_observation->>'fetch_url','username',p_observation->>'username','message_id',p_observation->>'message_id','expected_sha256',p_observation->>'expected_sha256','observed_sha256',p_observation->>'observed_sha256','published_at',p_observation->>'published_at','checked_at',clock_timestamp(),'revision',rev.revision,'brand_version',rev.brand_version,'actor',p_actor,'scope','public_text_only');
 UPDATE pcs.content_posts SET publication_verification=evidence,version=version+1,updated_at=clock_timestamp() WHERE id=post.id RETURNING * INTO post;
 result:=jsonb_build_object('ok',true,'id',post.id,'version',post.version,'status',post.status,'verification',evidence);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.verify-publication','content',post.id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'version',post.version,'verification',evidence),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,result);RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_verify_publication(jsonb,text,jsonb,jsonb) FROM PUBLIC;
