-- Semantic checks remain attached to canonical content and its immutable revisions.
ALTER TABLE pcs.content_posts ADD COLUMN IF NOT EXISTS content_duplicate_check jsonb;
CREATE OR REPLACE FUNCTION pcs.content_duplicate_context(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 WITH candidate AS (
  SELECT p.id,p.version,p.brand_id,b.version brand_version,r.revision,r.brand_version revision_brand_version,r.title,r.body,r.platform,r.language
  FROM pcs.content_posts p JOIN pcs.content_brands b ON b.id=p.brand_id
  JOIN LATERAL (SELECT * FROM pcs.content_revisions WHERE post_id=p.id ORDER BY revision DESC LIMIT 1) r ON true WHERE p.id=p_id
 ), corpus AS (
  SELECT p.id post_id,p.updated_at,r.revision,r.brand_version,r.title,r.body,r.platform,r.language
  FROM pcs.content_posts p JOIN candidate c ON p.brand_id=c.brand_id AND p.id<>c.id
  JOIN LATERAL (SELECT * FROM pcs.content_revisions WHERE post_id=p.id ORDER BY revision DESC LIMIT 1) r ON true
  ORDER BY p.updated_at DESC,p.id LIMIT 13
 ), data AS (
  SELECT jsonb_build_object('candidate',jsonb_build_object('post_id',c.id,'version',c.version,'brand_id',c.brand_id,'brand_version',c.brand_version,'revision_brand_version',c.revision_brand_version,'revision',c.revision,'title',c.title,'body',c.body,'platform',c.platform,'language',c.language),
   'corpus',coalesce((SELECT jsonb_agg(to_jsonb(x)-'updated_at' ORDER BY x.updated_at DESC,x.post_id) FROM (SELECT * FROM corpus ORDER BY updated_at DESC,post_id LIMIT 12) x),'[]'::jsonb),
   'corpus_count',(SELECT least(count(*),12) FROM corpus),'corpus_truncated',(SELECT count(*)>12 FROM corpus)) value FROM candidate c
 ) SELECT value||jsonb_build_object('snapshot_signature',md5(jsonb_set(value,'{candidate}',(value->'candidate')-'version')::text)) FROM data
$fn$;
REVOKE ALL ON FUNCTION pcs.content_duplicate_context(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_duplicate_snapshot(p_id uuid,p_version integer,p_actor text,p_permissions jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; post pcs.content_posts; brand_version integer; snapshot jsonb;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO post FROM pcs.content_posts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR p_version IS NULL OR p_version<1 OR post.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001';END IF;
 -- All content mutations lock the same brand before evaluating the corpus.
 SELECT version INTO brand_version FROM pcs.content_brands WHERE id=post.brand_id FOR UPDATE;
 snapshot:=pcs.content_duplicate_context(post.id);
 IF post.status<>'REVIEW' OR snapshot IS NULL OR snapshot#>>'{candidate,revision_brand_version}' IS DISTINCT FROM brand_version::text THEN RAISE EXCEPTION 'content_duplicate_requires_current_review' USING ERRCODE='22023';END IF;
 RETURN snapshot;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_duplicate_snapshot(uuid,integer,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_complete_duplicate_check(p jsonb,p_actor text,p_permissions jsonb,p_result jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; rid uuid; payload jsonb; prior pcs.content_commands; snapshot jsonb; current_snapshot jsonb; check_data jsonb; receipt jsonb; match jsonb; ids text[]:='{}'; post pcs.content_posts;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','id','expected_version','snapshot_signature')) OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(p->>'expected_version','') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'content_duplicate_invalid' USING ERRCODE='22023';END IF;
 rid:=(p->>'request_id')::uuid;payload:=jsonb_build_object('action','check-duplicates','body',p-'snapshot_signature','actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));
 SELECT * INTO prior FROM pcs.content_commands WHERE request_id=rid FOR UPDATE;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001';END IF;
  IF prior.result->>'pending' IS DISTINCT FROM 'true' THEN RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
  IF p_result IS NULL THEN RETURN jsonb_build_object('ok',true,'pending',true,'id',p->>'id');END IF;
  snapshot:=prior.result->'snapshot';
 ELSE
  IF p_result IS NOT NULL THEN RAISE EXCEPTION 'content_duplicate_prepare_required' USING ERRCODE='22023';END IF;
  snapshot:=pcs.content_duplicate_snapshot((p->>'id')::uuid,(p->>'expected_version')::integer,p_actor,p_permissions);
  INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,jsonb_build_object('ok',true,'pending',true,'id',p->>'id','snapshot',snapshot));
  INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.duplicate-check-started','content',p->>'id',jsonb_build_object('actor',p_actor,'request_id',rid,'snapshot_signature',snapshot->>'snapshot_signature'),'SUCCESS');
  RETURN jsonb_build_object('ok',true,'snapshot',snapshot);
 END IF;
 current_snapshot:=pcs.content_duplicate_snapshot((p->>'id')::uuid,(p->>'expected_version')::integer,p_actor,p_permissions);
 IF p->>'snapshot_signature' IS DISTINCT FROM snapshot->>'snapshot_signature' OR current_snapshot->>'snapshot_signature' IS DISTINCT FROM snapshot->>'snapshot_signature' THEN RAISE EXCEPTION 'content_duplicate_snapshot_conflict' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN ('outcome','matches','note','method')) OR coalesce(p_result->>'outcome','') NOT IN ('POSSIBLE_DUPLICATE','NO_SIMILARITY_FOUND') OR jsonb_typeof(p_result->'matches') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'matches')>12 OR jsonb_typeof(p_result->'note') IS DISTINCT FROM 'string' OR length(btrim(p_result->>'note')) NOT BETWEEN 1 AND 1000 OR coalesce(p_result->>'method','') NOT IN ('EMPTY_CORPUS','AI_SEMANTIC_COMPARISON') THEN RAISE EXCEPTION 'content_duplicate_result_invalid' USING ERRCODE='22023';END IF;
 IF ((snapshot->>'corpus_count')::integer=0) IS DISTINCT FROM (p_result->>'method'='EMPTY_CORPUS') OR (p_result->>'outcome'='POSSIBLE_DUPLICATE') IS DISTINCT FROM (jsonb_array_length(p_result->'matches')>0) THEN RAISE EXCEPTION 'content_duplicate_result_invalid' USING ERRCODE='22023';END IF;
 FOR match IN SELECT * FROM jsonb_array_elements(p_result->'matches') LOOP
  IF jsonb_typeof(match) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(match) k WHERE k NOT IN ('post_id','reason')) OR jsonb_typeof(match->'post_id') IS DISTINCT FROM 'string' OR jsonb_typeof(match->'reason') IS DISTINCT FROM 'string' OR length(btrim(match->>'reason')) NOT BETWEEN 10 AND 1000 OR match->>'post_id'=ANY(ids) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'corpus') c WHERE c->>'post_id'=match->>'post_id') THEN RAISE EXCEPTION 'content_duplicate_result_invalid' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,match->>'post_id');
 END LOOP;
 check_data:=jsonb_build_object('outcome',p_result->>'outcome','matches',p_result->'matches','note',btrim(p_result->>'note'),'method',p_result->>'method','revision',snapshot#>'{candidate,revision}','brand_version',snapshot#>'{candidate,brand_version}','checked_at',clock_timestamp(),'actor',p_actor,'corpus_count',snapshot->'corpus_count','corpus_truncated',snapshot->'corpus_truncated','snapshot_signature',snapshot->>'snapshot_signature','corpus',(SELECT coalesce(jsonb_agg(jsonb_build_object('post_id',c->>'post_id','revision',c->'revision','brand_version',c->'brand_version')),'[]'::jsonb) FROM jsonb_array_elements(snapshot->'corpus') c));
 UPDATE pcs.content_posts SET content_duplicate_check=check_data,version=version+1,updated_at=clock_timestamp() WHERE id=(p->>'id')::uuid RETURNING * INTO post;
 receipt:=jsonb_build_object('ok',true,'id',post.id,'version',post.version,'status',post.status,'duplicate_check',check_data);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.check-duplicates','content',post.id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'version',post.version,'duplicate_check',check_data),'SUCCESS');
 UPDATE pcs.content_commands SET result=receipt WHERE request_id=rid;
 RETURN receipt;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_complete_duplicate_check(jsonb,text,jsonb,jsonb) FROM PUBLIC;
