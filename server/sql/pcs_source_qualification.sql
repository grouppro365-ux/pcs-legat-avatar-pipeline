-- Local exact-span extraction into the existing application; never sends messages.
CREATE TABLE IF NOT EXISTS pcs.source_qualification_commands(application_id uuid NOT NULL REFERENCES public.applications(id),request_id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,request_id));
ALTER TABLE pcs.source_qualification_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pcs.source_qualification_commands FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.save_source_qualification(p_id uuid,p_version text,p_request uuid,p_type text,p_answers jsonb,p_evidence jsonb,p_source_hash text,p_auth uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE a public.applications%ROWTYPE; permissions jsonb; allowed text[]; fingerprint text; prior pcs.source_qualification_commands%ROWTYPE; result jsonb; data jsonb; item record; proof jsonb; source text;
BEGIN
 IF p_auth IS NOT NULL THEN
  permissions:=pcs.staff_context(p_auth)->'permissions';
  IF NOT(coalesce(permissions?'*',false) OR (coalesce(permissions?'applications.assign',false) AND coalesce(permissions?'clients.manage',false))) THEN RAISE EXCEPTION 'source_qualification_forbidden' USING ERRCODE='42501';END IF;
 END IF;
 allowed:=CASE p_type WHEN 'car_rental' THEN ARRAY['city','budget','requirements','start_date','end_date','vehicle_class','driver_age','delivery'] WHEN 'property_rent' THEN ARRAY['city','budget','requirements','start_date','end_date','property_type','guests','pets'] WHEN 'property_buy' THEN ARRAY['city','budget','requirements','property_type','purchase_goal','purchase_timing','ownership'] WHEN 'visa' THEN ARRAY['nationality','current_status','current_location','target_visa','timeline','applicants','requirements'] WHEN 'transfer' THEN ARRAY['city','budget','requirements','pickup','dropoff','transfer_date','transfer_time','passengers','luggage','child_seats','flight_number'] WHEN 'service' THEN ARRAY['city','budget','requirements','service_need','service_date','participants'] END;
 IF p_id IS NULL OR p_request IS NULL OR coalesce(p_version,'') !~ '^[a-f0-9]{32}$' OR coalesce(p_source_hash,'') !~ '^[a-f0-9]{32}$' OR (p_type IS NOT NULL AND allowed IS NULL) OR jsonb_typeof(p_answers) IS DISTINCT FROM 'object' OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(p_evidence->'answers') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k NOT IN ('type','answers')) OR (p_type IS NULL AND (p_answers<>'{}' OR p_evidence->'type' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'source_qualification_invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_answers) x WHERE NOT(coalesce(x.key=ANY(allowed),false)) OR jsonb_typeof(x.value)<>'string' OR length(btrim(x.value#>>'{}')) NOT BETWEEN 1 AND 1000) OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_answers) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_evidence->'answers') k) THEN RAISE EXCEPTION 'source_qualification_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.applications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_qualification_changed' USING ERRCODE='40001';END IF;
 fingerprint:=md5(jsonb_build_object('method','deterministic_exact_source_spans_v1','type',p_type,'answers',p_answers,'evidence',p_evidence,'source_hash',p_source_hash,'version',p_version,'auth_user_id',p_auth)::text);
 SELECT * INTO prior FROM pcs.source_qualification_commands WHERE application_id=p_id AND request_id=p_request;
 IF FOUND THEN IF prior.fingerprint<>fingerprint THEN RAISE EXCEPTION 'source_qualification_retry_changed' USING ERRCODE='23505';END IF;RETURN prior.result;END IF;
 IF a.qualification_data->'operator_qualification' IS NOT NULL OR a.selected_partner_offer_id IS NOT NULL OR a.operational_status NOT IN ('NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') THEN RAISE EXCEPTION 'source_qualification_locked' USING ERRCODE='23514';END IF;
 source:=coalesce(a.client_visible_notes,'');
 IF md5(to_jsonb(a)::text)<>p_version OR md5(source)<>p_source_hash OR length(source) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'source_qualification_changed' USING ERRCODE='40001';END IF;
 FOR item IN SELECT key,value FROM jsonb_each(p_evidence->'answers') UNION ALL SELECT '_type',p_evidence->'type' WHERE p_type IS NOT NULL LOOP
  proof:=item.value;
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(proof) k WHERE k NOT IN ('start','end','quote')) OR (SELECT count(*) FROM jsonb_object_keys(proof))<>3 OR jsonb_typeof(proof->'quote') IS DISTINCT FROM 'string' OR jsonb_typeof(proof->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(proof->'end') IS DISTINCT FROM 'number' OR coalesce(proof->>'start','') !~ '^[0-9]{1,4}$' OR coalesce(proof->>'end','') !~ '^[0-9]{1,4}$' THEN RAISE EXCEPTION 'source_qualification_invalid' USING ERRCODE='22023';END IF;
  IF (proof->>'end')::integer<=(proof->>'start')::integer OR (proof->>'end')::integer>length(source) OR length(proof->>'quote') NOT BETWEEN 1 AND 1000 OR substring(source FROM (proof->>'start')::integer+1 FOR (proof->>'end')::integer-(proof->>'start')::integer) IS DISTINCT FROM proof->>'quote' OR (item.key<>'_type' AND p_answers->>item.key IS DISTINCT FROM proof->>'quote') THEN RAISE EXCEPTION 'source_qualification_invalid' USING ERRCODE='22023';END IF;
 END LOOP;
 BEGIN
  FOR item IN SELECT key,value#>>'{}' value FROM jsonb_each(p_answers) WHERE key IN ('start_date','end_date','transfer_date') LOOP
   IF item.value !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(item.value::date,'YYYY-MM-DD')<>item.value THEN RAISE EXCEPTION 'source_qualification_invalid';END IF;
  END LOOP;
  IF p_answers?'transfer_time' AND p_answers->>'transfer_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p_answers?'start_date' AND p_answers?'end_date' AND p_answers->>'start_date'>=p_answers->>'end_date' THEN RAISE EXCEPTION 'source_qualification_invalid';END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'source_qualification_invalid' USING ERRCODE='22023';END;
 data:=jsonb_build_object('type',p_type,'answers',p_answers,'evidence',p_evidence,'source_hash',p_source_hash,'source','application.client_visible_notes','recorded_at',clock_timestamp(),'auth_user_id',p_auth,'method','deterministic_exact_source_spans_v1','review_required',true);
 UPDATE public.applications SET qualification_data=coalesce(qualification_data,'{}'::jsonb)||jsonb_build_object('source_qualification',data),updated_at=clock_timestamp() WHERE id=p_id RETURNING jsonb_build_object('application_id',id,'edit_version',md5(to_jsonb(applications)::text)) INTO result;
 INSERT INTO public.audit_events(actor_role,action,entity_type,entity_id,patch,reason,result) VALUES(CASE WHEN p_auth IS NULL THEN 'ADMIN' ELSE 'STAFF' END,'request_qualification_extracted','applications',p_id::text,jsonb_build_object('auth_user_id',p_auth,'request_id',p_request,'before',a.qualification_data->'source_qualification','after',data),'Local exact recorded-note spans; requires review; no booking or price changes','SUCCESS');
 INSERT INTO pcs.source_qualification_commands(application_id,request_id,fingerprint,result) VALUES(p_id,p_request,fingerprint,result);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.save_source_qualification(uuid,text,uuid,text,jsonb,jsonb,text,uuid) FROM PUBLIC;
