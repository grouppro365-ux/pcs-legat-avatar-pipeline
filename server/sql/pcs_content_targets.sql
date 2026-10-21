-- Verified Telegram destinations only. This registry never sends or schedules posts.
CREATE TABLE IF NOT EXISTS pcs.content_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),brand_id uuid NOT NULL REFERENCES pcs.content_brands(id),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 username text NOT NULL UNIQUE CHECK(username ~ '^[a-z][a-z0-9_]{3,31}$'),
 chat_id text NOT NULL UNIQUE CHECK(chat_id ~ '^-[1-9][0-9]{0,18}$'),
 bot_id text NOT NULL CHECK(bot_id ~ '^[1-9][0-9]{0,18}$'),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 256),enabled boolean NOT NULL DEFAULT true,
 verified_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON pcs.content_targets FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_target_action(p jsonb,p_actor text,p_permissions jsonb,p_observation jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE permissions jsonb; rid uuid; payload jsonb; prior pcs.content_commands; target pcs.content_targets; receipt jsonb; brand uuid;
BEGIN
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(permissions) IS DISTINCT FROM 'array' OR NOT coalesce(permissions?'*' OR permissions?'content.approve',false) THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('request_id','brand_id','username','id','expected_version')) OR jsonb_typeof(p->'request_id') IS DISTINCT FROM 'string' OR coalesce(p->>'request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'brand_id') IS DISTINCT FROM 'string' OR coalesce(p->>'brand_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'username') IS DISTINCT FROM 'string' OR coalesce(p->>'username','') !~ '^[a-z][a-z0-9_]{3,31}$' THEN RAISE EXCEPTION 'content_target_invalid' USING ERRCODE='22023';END IF;
 IF p?'id' THEN
  IF jsonb_typeof(p->'id') IS DISTINCT FROM 'string' OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(p->'expected_version') IS DISTINCT FROM 'number' OR coalesce(p->>'expected_version','') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'content_target_invalid' USING ERRCODE='22023';END IF;
 ELSIF p?'expected_version' THEN RAISE EXCEPTION 'content_target_invalid' USING ERRCODE='22023';END IF;
 rid:=(p->>'request_id')::uuid;payload:=jsonb_build_object('action','target','body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));
 SELECT * INTO prior FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF prior.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001';END IF;RETURN prior.result||'{"replayed":true}'::jsonb;END IF;
 SELECT id INTO brand FROM pcs.content_brands WHERE id=(p->>'brand_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'content_target_brand_missing' USING ERRCODE='22023';END IF;
 IF p?'id' THEN
  SELECT * INTO target FROM pcs.content_targets WHERE id=(p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR target.brand_id<>brand OR target.version IS DISTINCT FROM (p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_target_version_conflict' USING ERRCODE='40001';END IF;
 END IF;
 IF p_observation IS NULL THEN RETURN jsonb_build_object('ok',true,'verification_required',true,'snapshot',jsonb_build_object('id',target.id,'version',target.version,'brand_id',brand,'username',p->>'username'));END IF;
 IF jsonb_typeof(p_observation) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_observation) k WHERE k NOT IN ('username','chat_id','bot_id','title','can_post_messages')) OR (SELECT count(*) FROM jsonb_object_keys(p_observation))<>5 OR p_observation->>'username' IS DISTINCT FROM p->>'username' OR jsonb_typeof(p_observation->'username') IS DISTINCT FROM 'string' OR jsonb_typeof(p_observation->'chat_id') IS DISTINCT FROM 'string' OR coalesce(p_observation->>'chat_id','') !~ '^-[1-9][0-9]{0,18}$' OR jsonb_typeof(p_observation->'bot_id') IS DISTINCT FROM 'string' OR coalesce(p_observation->>'bot_id','') !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(p_observation->'title') IS DISTINCT FROM 'string' OR length(btrim(p_observation->>'title')) NOT BETWEEN 1 AND 256 OR p_observation->'can_post_messages' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'content_target_observation_invalid' USING ERRCODE='22023';END IF;
 BEGIN
  IF target.id IS NULL THEN
   INSERT INTO pcs.content_targets(brand_id,username,chat_id,bot_id,title,enabled,verified_at,updated_at) VALUES(brand,p->>'username',p_observation->>'chat_id',p_observation->>'bot_id',btrim(p_observation->>'title'),true,clock_timestamp(),clock_timestamp()) RETURNING * INTO target;
  ELSE
   UPDATE pcs.content_targets SET username=p->>'username',chat_id=p_observation->>'chat_id',bot_id=p_observation->>'bot_id',title=btrim(p_observation->>'title'),enabled=true,version=version+1,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=target.id RETURNING * INTO target;
  END IF;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'content_target_channel_conflict' USING ERRCODE='23505';END;
 receipt:=jsonb_build_object('ok',true,'id',target.id,'version',target.version,'target',to_jsonb(target));
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.target','content_target',target.id::text,jsonb_build_object('actor',p_actor,'request_id',rid,'brand_id',brand,'version',target.version,'username',target.username,'chat_id',target.chat_id,'bot_id',target.bot_id),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,receipt);RETURN receipt;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_target_action(jsonb,text,jsonb,jsonb) FROM PUBLIC;
