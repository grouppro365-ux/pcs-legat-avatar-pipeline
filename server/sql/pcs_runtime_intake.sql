-- Canonical intake from authenticated channel ingress. This never merges profiles
-- using a display name, username or telephone number. Channel ownership is not
-- equivalent to managed cabinet ownership: invitations remain a separate step.
CREATE OR REPLACE FUNCTION pcs.runtime_intake(p_contact uuid,p_request uuid,p_channel text,p_message uuid,p_telegram text,p_username text,p_name text,p_need text,p_actor text DEFAULT 'pcs-manager-admin')
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE c public.client_profiles%ROWTYPE; a public.applications%ROWTYPE; profile_id uuid; count_profiles integer;
BEGIN
 IF p_contact IS NULL OR p_request IS NULL OR p_channel IS NULL OR p_channel NOT IN ('telegram','whatsapp','instagram','facebook') OR p_need IS NULL OR length(btrim(p_need)) NOT BETWEEN 1 AND 4000 OR length(coalesce(p_actor,'')) NOT BETWEEN 1 AND 200 OR (p_channel<>'telegram' AND p_message IS NULL) OR (p_channel='telegram' AND coalesce(p_telegram,'') !~ '^[0-9]{1,20}$') THEN
  RAISE EXCEPTION 'runtime_intake_invalid' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('runtime-intake-contact:'||p_contact::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('runtime-intake-request:'||p_request::text,0));
 SELECT * INTO a FROM public.applications WHERE id=p_request FOR UPDATE;
 IF FOUND THEN
  IF a.qualification_data#>>'{runtime_intake,contact_id}' IS DISTINCT FROM p_contact::text OR a.qualification_data#>>'{runtime_intake,channel}' IS DISTINCT FROM p_channel OR a.client_visible_notes IS DISTINCT FROM btrim(p_need) THEN
   RAISE EXCEPTION 'runtime_intake_request_conflict' USING ERRCODE='23505';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.client_profiles WHERE id=a.client_profile_id AND source_contact_id=p_contact AND blocked IS NOT TRUE AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'runtime_intake_identity_unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',a.id,'public_id',a.public_id,'client_profile_id',a.client_profile_id,'client_visible_notes',a.client_visible_notes);
 END IF;
 IF p_channel='telegram' THEN
  profile_id:=(pcs.ensure_telegram_client_profile(p_contact,p_telegram,p_username,p_name)->>'id')::uuid;
 ELSE
  -- A runtime contact UUID is the sole binding. Do not follow a merge automatically:
  -- that requires a separately verified ownership/reconciliation procedure.
  SELECT count(*) INTO count_profiles FROM public.client_profiles WHERE source_contact_id=p_contact;
  IF count_profiles>1 THEN RAISE EXCEPTION 'runtime_intake_identity_conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO c FROM public.client_profiles WHERE source_contact_id=p_contact FOR UPDATE;
  IF FOUND THEN
   IF c.blocked IS TRUE OR c.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'runtime_intake_identity_unavailable' USING ERRCODE='42501'; END IF;
   profile_id:=c.id;
  ELSE
   INSERT INTO public.client_profiles(source_contact_id,display_name,contact,source)
   VALUES(p_contact,nullif(left(btrim(p_name),200),''),p_channel||':'||p_contact::text,'conversation_hub') RETURNING id INTO profile_id;
  END IF;
 END IF;
 INSERT INTO public.applications(id,public_id,client_profile_id,client_name,client_contact,category,client_visible_notes,source_code,human_review_required,next_action_code,qualification_data)
 VALUES(p_request,'APP-'||replace(p_request::text,'-',''),profile_id,left(p_name,200),CASE WHEN p_channel='telegram' THEN p_telegram ELSE p_channel||':'||p_contact::text END,'general',btrim(p_need),'UNIFIED_INBOX',true,'QUALIFY_REQUEST',jsonb_build_object('contact_id',p_contact,'runtime_intake',jsonb_build_object('contact_id',p_contact,'channel',p_channel,'inbound_message_id',p_message))) RETURNING * INTO a;
 INSERT INTO public.audit_events(actor_role,action,entity_type,entity_id,patch,result)
 VALUES('ADMIN','runtime.request.created','applications',a.id::text,jsonb_build_object('actor',p_actor,'client_profile_id',profile_id,'contact_id',p_contact,'channel',p_channel,'inbound_message_id',p_message),'SUCCESS');
 RETURN jsonb_build_object('id',a.id,'public_id',a.public_id,'client_profile_id',a.client_profile_id,'client_visible_notes',a.client_visible_notes);
END $fn$;
REVOKE ALL ON FUNCTION pcs.runtime_intake(uuid,uuid,text,uuid,text,text,text,text,text) FROM PUBLIC;
