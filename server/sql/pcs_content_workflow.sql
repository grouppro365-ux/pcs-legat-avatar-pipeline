-- PCS content authoring uses the existing business database. No publication or GPU side effects.
CREATE TABLE IF NOT EXISTS pcs.content_brands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),guidelines text NOT NULL CHECK(length(guidelines) BETWEEN 10 AND 12000),version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pcs.content_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),brand_id uuid NOT NULL REFERENCES pcs.content_brands(id),version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','APPROVED','READY','PUBLICATION_REPORTED')),scheduled_at timestamptz,approved_revision integer,approved_by text,approved_at timestamptz,publication_url text,publication_note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pcs.content_revisions(post_id uuid NOT NULL REFERENCES pcs.content_posts(id),revision integer NOT NULL,brand_version integer NOT NULL,brand_guidelines text NOT NULL,platform text NOT NULL CHECK(platform IN ('telegram','instagram','facebook','youtube','tiktok','website')),language text NOT NULL CHECK(language IN ('ru','en','th','pl','es','zh','ja','ko','ar','fr','de','kk')),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),source_facts text NOT NULL CHECK(length(source_facts) BETWEEN 1 AND 16000),source_url text NOT NULL CHECK(length(source_url) BETWEEN 1 AND 2048),qa jsonb NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(post_id,revision));
CREATE TABLE IF NOT EXISTS pcs.content_commands(request_id uuid PRIMARY KEY,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON pcs.content_brands,pcs.content_posts,pcs.content_revisions,pcs.content_commands FROM PUBLIC;
INSERT INTO pcs.role_permissions(role,permission,scope) VALUES('OPS_ADMIN','content.view','GLOBAL'),('OPS_ADMIN','content.edit','GLOBAL'),('OPS_ADMIN','content.approve','GLOBAL'),('CONCIERGE_MANAGER','content.view','GLOBAL'),('CONCIERGE_MANAGER','content.edit','GLOBAL'),('CONCIERGE_MANAGER','content.approve','GLOBAL'),('AUDITOR_READONLY','content.view','GLOBAL') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION pcs.content_qa(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE flags jsonb:='[]'; cap integer; txt text:=coalesce(p->>'body','');
BEGIN
 cap:=CASE p->>'platform' WHEN 'telegram' THEN 4096 WHEN 'instagram' THEN 2200 WHEN 'youtube' THEN 5000 WHEN 'tiktok' THEN 2200 ELSE 12000 END;
 IF length(txt)>cap THEN flags:=flags||jsonb_build_array('platform_length'); END IF;
 IF length(btrim(coalesce(p->>'source_facts','')))<20 THEN flags:=flags||jsonb_build_array('source_facts_missing'); END IF;
 IF coalesce(p->>'source_url','') !~ '^https://[^[:space:]]+$' THEN flags:=flags||jsonb_build_array('source_link_missing'); END IF;
 IF txt ~* '(100%|guarantee|гарантир|без риска|risk.free|лучший|самый деш|best price|unlimited|неогранич)' THEN flags:=flags||jsonb_build_array('promise_requires_review'); END IF;
 IF txt ~ '(\{\{|\[TODO|TBD|XXX)' THEN flags:=flags||jsonb_build_array('unfinished_placeholder'); END IF;
 RETURN jsonb_build_object('flags',flags,'length',length(txt),'limit',cap,'method','deterministic_checks','human_fact_check_required',true);
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_qa(jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.content_action(p_action text,p jsonb,p_actor text,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE required text; b pcs.content_brands; post pcs.content_posts; rev pcs.content_revisions; old pcs.content_commands; result jsonb; rid uuid; pid uuid; nextrev integer; payload jsonb; flags jsonb; effective_permissions jsonb;
BEGIN
 required:=CASE WHEN p_action IN ('approve','schedule','report-publication') THEN 'content.approve' ELSE 'content.edit' END;
 IF p_actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
  effective_permissions:=pcs.staff_context(p_actor::uuid)->'permissions';
 ELSIF p_actor='pcs-manager-admin' THEN effective_permissions:=p_permissions;
 ELSE RAISE EXCEPTION 'content_actor_invalid' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(effective_permissions) IS DISTINCT FROM 'array' OR NOT coalesce((effective_permissions ? '*' OR effective_permissions ? required),false) OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'content_forbidden' USING ERRCODE='42501'; END IF;
 rid:=(p->>'request_id')::uuid;IF rid IS NULL THEN RAISE EXCEPTION 'content_request_required' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('action',p_action,'body',p,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(rid::text,61));
 SELECT * INTO old FROM pcs.content_commands WHERE request_id=rid;
 IF FOUND THEN IF old.payload<>payload THEN RAISE EXCEPTION 'content_request_conflict' USING ERRCODE='40001';END IF;RETURN old.result||'{"replayed":true}'::jsonb;END IF;
 IF p_action='brand' THEN
  IF length(btrim(coalesce(p->>'name','')))<1 OR length(btrim(coalesce(p->>'guidelines','')))<10 THEN RAISE EXCEPTION 'content_brand_invalid' USING ERRCODE='22023';END IF;
  IF nullif(p->>'id','') IS NULL THEN INSERT INTO pcs.content_brands(name,guidelines) VALUES(btrim(p->>'name'),btrim(p->>'guidelines')) RETURNING * INTO b;
  ELSE UPDATE pcs.content_brands SET name=btrim(p->>'name'),guidelines=btrim(p->>'guidelines'),version=version+1,updated_at=clock_timestamp() WHERE id=(p->>'id')::uuid AND version=(p->>'expected_version')::integer RETURNING * INTO b;IF NOT FOUND THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001';END IF;END IF;
  result:=jsonb_build_object('ok',true,'brand',to_jsonb(b));
 ELSE
  IF p_action='create' THEN
   SELECT * INTO b FROM pcs.content_brands WHERE id=(p->>'brand_id')::uuid FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'content_brand_missing' USING ERRCODE='22023';END IF;
   INSERT INTO pcs.content_posts(brand_id) VALUES(b.id) RETURNING * INTO post;nextrev:=1;
  ELSE
   SELECT * INTO post FROM pcs.content_posts WHERE id=(p->>'id')::uuid FOR UPDATE;
   IF NOT FOUND OR post.version IS DISTINCT FROM (p->>'expected_version')::integer THEN RAISE EXCEPTION 'content_version_conflict' USING ERRCODE='40001';END IF;
   IF post.status='PUBLICATION_REPORTED' THEN RAISE EXCEPTION 'content_already_reported' USING ERRCODE='22023';END IF;
   SELECT * INTO b FROM pcs.content_brands WHERE id=post.brand_id FOR SHARE;
   SELECT * INTO rev FROM pcs.content_revisions WHERE post_id=post.id ORDER BY revision DESC LIMIT 1;
   nextrev:=rev.revision+1;
  END IF;
  IF p_action IN ('create','revise') THEN
   INSERT INTO pcs.content_revisions(post_id,revision,brand_version,brand_guidelines,platform,language,title,body,source_facts,source_url,qa,created_by) VALUES(post.id,nextrev,b.version,b.guidelines,p->>'platform',p->>'language',btrim(p->>'title'),btrim(p->>'body'),btrim(p->>'source_facts'),btrim(p->>'source_url'),pcs.content_qa(p),p_actor);
   UPDATE pcs.content_posts SET status='DRAFT',scheduled_at=NULL,approved_revision=NULL,approved_by=NULL,approved_at=NULL WHERE id=post.id;
  ELSIF p_action='submit' THEN
   IF post.status<>'DRAFT' THEN RAISE EXCEPTION 'content_invalid_transition' USING ERRCODE='22023';END IF;
   UPDATE pcs.content_posts SET status='REVIEW' WHERE id=post.id;
  ELSIF p_action='approve' THEN
   IF post.status<>'REVIEW' OR rev.brand_version<>b.version OR (p->>'revision')::integer IS DISTINCT FROM rev.revision OR coalesce((p->>'facts_checked')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'content_approval_requires_current_fact_check' USING ERRCODE='22023';END IF;
   flags:=rev.qa->'flags';
   IF flags ? 'platform_length' OR flags ? 'source_facts_missing' OR flags ? 'source_link_missing' OR flags ? 'unfinished_placeholder' THEN RAISE EXCEPTION 'content_qa_blocked' USING ERRCODE='22023';END IF;
   IF flags ? 'promise_requires_review' AND length(btrim(coalesce(p->>'review_note','')))<20 THEN RAISE EXCEPTION 'content_promise_review_required' USING ERRCODE='22023';END IF;
   UPDATE pcs.content_posts SET status='APPROVED',approved_revision=rev.revision,approved_by=p_actor,approved_at=clock_timestamp() WHERE id=post.id;
  ELSIF p_action='schedule' THEN
   IF coalesce(p->>'scheduled_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' OR post.status<>'APPROVED' OR rev.brand_version<>b.version OR post.approved_revision IS DISTINCT FROM rev.revision OR (p->>'scheduled_at')::timestamptz IS NULL OR (p->>'scheduled_at')::timestamptz<=now() THEN RAISE EXCEPTION 'content_schedule_invalid' USING ERRCODE='22023';END IF;
   UPDATE pcs.content_posts SET status='READY',scheduled_at=(p->>'scheduled_at')::timestamptz WHERE id=post.id;
  ELSIF p_action='report-publication' THEN
   IF post.status NOT IN ('APPROVED','READY') OR rev.brand_version<>b.version OR post.approved_revision IS DISTINCT FROM rev.revision OR coalesce(p->>'publication_url','') !~ '^https://[^[:space:]]+$' OR length(coalesce(p->>'publication_url',''))>2048 OR length(btrim(coalesce(p->>'publication_note','')))<20 OR length(p->>'publication_note')>4000 THEN RAISE EXCEPTION 'content_publication_evidence_required' USING ERRCODE='22023';END IF;
   UPDATE pcs.content_posts SET status='PUBLICATION_REPORTED',publication_url=p->>'publication_url',publication_note=p->>'publication_note' WHERE id=post.id;
  ELSE RAISE EXCEPTION 'content_unknown_action' USING ERRCODE='22023';END IF;
  UPDATE pcs.content_posts SET version=version+1,updated_at=clock_timestamp() WHERE id=post.id RETURNING * INTO post;
  result:=jsonb_build_object('ok',true,'id',post.id,'version',post.version,'status',post.status);
 END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','content.'||p_action,'content',coalesce(post.id,b.id)::text,jsonb_build_object('actor',p_actor,'request_id',rid,'version',post.version,'revision',CASE WHEN p_action IN ('create','revise') THEN nextrev ELSE rev.revision END,'review_note',p->>'review_note'),'SUCCESS');
 INSERT INTO pcs.content_commands(request_id,payload,result) VALUES(rid,payload,result);RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.content_action(text,jsonb,text,jsonb) FROM PUBLIC;
