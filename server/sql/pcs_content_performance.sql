-- Public Telegram counters are observations, not attribution or ROI.
ALTER TABLE pcs.content_posts ADD COLUMN IF NOT EXISTS content_performance jsonb;
CREATE TABLE IF NOT EXISTS pcs.content_performance_observations(
 request_id uuid PRIMARY KEY REFERENCES pcs.content_commands(request_id) DEFERRABLE INITIALLY DEFERRED,
 post_id uuid NOT NULL REFERENCES pcs.content_posts(id), evidence jsonb NOT NULL,
 checked_at timestamptz NOT NULL, revision integer NOT NULL, brand_version integer NOT NULL, actor text NOT NULL
);
CREATE INDEX IF NOT EXISTS pcs_content_performance_history_idx ON pcs.content_performance_observations(post_id,checked_at DESC,request_id DESC);
CREATE OR REPLACE FUNCTION pcs.content_performance_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'content_performance_immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION pcs.content_performance_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS content_performance_immutable ON pcs.content_performance_observations;
CREATE TRIGGER content_performance_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON pcs.content_performance_observations
 FOR EACH STATEMENT EXECUTE FUNCTION pcs.content_performance_immutable();
REVOKE ALL ON pcs.content_performance_observations FROM PUBLIC;

CREATE OR REPLACE FUNCTION pcs.content_observe_performance(p jsonb,p_actor text,p_permissions jsonb,p_evidence jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; rid uuid; payload jsonb; prior pcs.content_commands; post pcs.content_posts; rev pcs.content_revisions;
 evidence jsonb; result jsonb; canonical_url text; signature text; v jsonb; display text; amount numeric; checked timestamptz;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>3 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('id','request_id','expected_version'))
 OR jsonb_typeof(p->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'request_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number'
 OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR coalesce(p->>'expected_version','') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 rid:=(p->>'request_id')::uuid; payload:=jsonb_build_object('action','observe-performance','body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));
 SELECT * INTO prior FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001'; END IF;
  RETURN prior.result||'{"replayed":true}'::jsonb;
 END IF;
 SELECT * INTO post FROM pcs.content_posts WHERE id=(p->>'id')::uuid FOR UPDATE;
 IF NOT FOUND OR post.version IS DISTINCT FROM (p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
 IF rev.post_id IS NULL OR post.status NOT IN ('PUBLICATION_REPORTED','PUBLICATION_SENT') OR rev.platform<>'telegram' OR post.approved_revision IS DISTINCT FROM rev.revision THEN RAISE EXCEPTION 'content_performance_requires_reported_current_approval' USING ERRCODE='22023'; END IF;
 signature:=md5(jsonb_build_array(post.id,post.version,rev.revision,post.brand_id,rev.brand_version,rev.body,post.publication_url)::text);
 IF p_evidence IS NULL THEN RETURN jsonb_build_object('ok',true,'observation_required',true,'snapshot',jsonb_build_object('body',rev.body,'publication_url',post.publication_url,'snapshot_signature',signature)); END IF;
 IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>12 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k NOT IN ('method','outcome','reason','publication_url','fetch_url','username','message_id','expected_sha256','observed_sha256','published_at','views','snapshot_signature')) THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 IF p_evidence->>'snapshot_signature' IS DISTINCT FROM signature THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001'; END IF;
 canonical_url:=regexp_replace(regexp_replace(lower(post.publication_url),'^https://t[.]me/s/','https://t.me/'),'/$','');
 IF EXISTS(SELECT 1 FROM jsonb_each(p_evidence) kv WHERE kv.key NOT IN ('observed_sha256','published_at','views') AND jsonb_typeof(kv.value)<>'string')
 OR p_evidence->>'method' IS DISTINCT FROM 'public_telegram_views_v1'
 OR coalesce(p_evidence->>'outcome','') NOT IN ('OBSERVED','UNAVAILABLE')
 OR coalesce(p_evidence->>'reason','') NOT IN ('counter_observed','counter_missing','counter_ambiguous','counter_unreadable','text_mismatch','redirect_refused','page_unavailable','fetch_timeout','page_too_large','ambiguous_message','message_missing','text_unreadable')
 OR p_evidence->>'publication_url' IS DISTINCT FROM canonical_url
 OR coalesce(canonical_url,'') !~ '^https://t[.]me/[a-z][a-z0-9_]{3,31}/[1-9][0-9]{0,14}$'
 OR coalesce(p_evidence->>'expected_sha256','') !~ '^[a-f0-9]{64}$'
 OR coalesce(p_evidence->>'message_id','') !~ '^[1-9][0-9]{0,14}$'
 OR canonical_url IS DISTINCT FROM 'https://t.me/'||(p_evidence->>'username')||'/'||(p_evidence->>'message_id') THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 IF p_evidence->>'fetch_url' IS DISTINCT FROM 'https://t.me/s/'||(p_evidence->>'username')||'?before='||((p_evidence->>'message_id')::bigint+1)::text THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 IF p_evidence->>'reason' IN ('counter_observed','counter_missing','counter_ambiguous','counter_unreadable','text_mismatch') THEN
  IF jsonb_typeof(p_evidence->'observed_sha256') IS DISTINCT FROM 'string' OR coalesce(p_evidence->>'observed_sha256','') !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_evidence->'published_at') IS DISTINCT FROM 'string' OR coalesce(p_evidence->>'published_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
  PERFORM (p_evidence->>'published_at')::timestamptz;
  IF (p_evidence->>'reason'='text_mismatch') IS DISTINCT FROM (p_evidence->>'observed_sha256'<>p_evidence->>'expected_sha256') THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_evidence->'observed_sha256' IS DISTINCT FROM 'null'::jsonb OR p_evidence->'published_at' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_evidence->>'outcome'='OBSERVED' THEN
  v:=p_evidence->'views';
  IF p_evidence->>'reason'<>'counter_observed' OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v))<>4 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('display','exact','estimate','approximate')) OR jsonb_typeof(v->'display') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'approximate') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
  display:=v->>'display';
  IF display ~ '^(0|[1-9][0-9]{0,18})$' THEN
   amount:=display::numeric;
   IF amount>9223372036854775807 OR v->'exact' IS DISTINCT FROM to_jsonb(display) OR v->'estimate' IS DISTINCT FROM 'null'::jsonb OR v->'approximate' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
  ELSIF display ~ '^(0|[1-9][0-9]{0,18})(\.[0-9]{1,2})?[KM]$' THEN
   amount:=left(display,length(display)-1)::numeric * CASE right(display,1) WHEN 'K' THEN 1000 ELSE 1000000 END;
   IF amount>9223372036854775807 OR jsonb_typeof(v->'estimate') IS DISTINCT FROM 'string' OR coalesce(v->>'estimate','') !~ '^(0|[1-9][0-9]{0,18})$' OR (v->>'estimate')::numeric<>amount OR v->'exact' IS DISTINCT FROM 'null'::jsonb OR v->'approximate' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_evidence->>'reason'='counter_observed' OR p_evidence->'views' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'content_performance_invalid' USING ERRCODE='22023'; END IF;
 END IF;
 checked:=clock_timestamp();
 evidence:=p_evidence||jsonb_build_object('checked_at',checked,'revision',rev.revision,'brand_version',rev.brand_version,'actor',p_actor,'scope','public_views_only');
 INSERT INTO pcs.content_performance_observations(request_id,post_id,evidence,checked_at,revision,brand_version,actor) VALUES(rid,post.id,evidence,checked,rev.revision,rev.brand_version,p_actor);
 UPDATE pcs.content_posts SET content_performance=evidence,version=version+1,updated_at=checked WHERE id=post.id RETURNING * INTO post;
 result:=jsonb_build_object('ok',true,'id',post.id,'version',post.version,'status',post.status,'observation',evidence);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.observe-performance','content',post.id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'version',post.version,'performance',evidence),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,result);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_observe_performance(jsonb,text,jsonb,jsonb) FROM PUBLIC;
