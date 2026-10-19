-- Answers live within the existing application. They are not booking terms or facts of availability.
CREATE TABLE IF NOT EXISTS pcs.request_qualification_commands (
 application_id uuid NOT NULL REFERENCES public.applications(id),request_id uuid NOT NULL,
 fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,request_id)
);
ALTER TABLE pcs.request_qualification_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pcs.request_qualification_commands FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.save_request_qualification(p_id uuid,p_version text,p_request uuid,p_type text,p_answers jsonb,p_note text,p_auth uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE a public.applications%ROWTYPE; permissions jsonb; allowed text[]; fingerprint text; prior pcs.request_qualification_commands%ROWTYPE; result jsonb; data jsonb;
BEGIN
 IF p_auth IS NOT NULL THEN
  permissions:=pcs.staff_context(p_auth)->'permissions';
  IF NOT(coalesce(permissions?'*',false) OR (coalesce(permissions?'applications.assign',false) AND coalesce(permissions?'clients.manage',false))) THEN RAISE EXCEPTION 'qualification_forbidden' USING ERRCODE='42501';END IF;
 END IF;
 allowed:=CASE p_type WHEN 'car_rental' THEN ARRAY['city','budget','requirements','start_date','end_date','vehicle_class','driver_age','delivery'] WHEN 'property_rent' THEN ARRAY['city','budget','requirements','start_date','end_date','property_type','guests','pets'] WHEN 'property_buy' THEN ARRAY['city','budget','requirements','property_type','purchase_goal','purchase_timing','ownership'] WHEN 'visa' THEN ARRAY['nationality','current_status','current_location','target_visa','timeline','applicants','requirements'] WHEN 'transfer' THEN ARRAY['city','budget','requirements','pickup','dropoff','transfer_date','transfer_time','passengers','luggage','child_seats','flight_number'] WHEN 'service' THEN ARRAY['city','budget','requirements','service_need','service_date','participants'] END;
 IF p_id IS NULL OR p_request IS NULL OR p_version IS NULL OR p_version !~ '^[a-f0-9]{32}$' OR allowed IS NULL OR jsonb_typeof(p_answers) IS DISTINCT FROM 'object' OR length(trim(coalesce(p_note,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'qualification_invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_answers) x WHERE NOT(x.key=ANY(allowed)) OR jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000) THEN RAISE EXCEPTION 'qualification_invalid' USING ERRCODE='22023';END IF;
 BEGIN
  IF (coalesce(p_answers->>'transfer_date','')<>'' AND (p_answers->>'transfer_date' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((p_answers->>'transfer_date')::date,'YYYY-MM-DD')<>p_answers->>'transfer_date')) OR (coalesce(p_answers->>'transfer_time','')<>'' AND p_answers->>'transfer_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') OR (coalesce(p_answers->>'start_date','')<>'' AND (p_answers->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((p_answers->>'start_date')::date,'YYYY-MM-DD')<>p_answers->>'start_date')) OR (coalesce(p_answers->>'end_date','')<>'' AND (p_answers->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((p_answers->>'end_date')::date,'YYYY-MM-DD')<>p_answers->>'end_date')) OR (coalesce(p_answers->>'start_date','')<>'' AND coalesce(p_answers->>'end_date','')<>'' AND (p_answers->>'start_date')::date >= (p_answers->>'end_date')::date) THEN RAISE EXCEPTION 'qualification_invalid';END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'qualification_invalid' USING ERRCODE='22023'; END;
 SELECT * INTO a FROM public.applications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'qualification_changed' USING ERRCODE='40001';END IF;
 fingerprint:=md5(jsonb_build_object('type',p_type,'answers',p_answers,'note',trim(p_note),'version',p_version,'auth_user_id',p_auth)::text);
 SELECT * INTO prior FROM pcs.request_qualification_commands WHERE application_id=p_id AND request_id=p_request;
 IF FOUND THEN IF prior.fingerprint<>fingerprint THEN RAISE EXCEPTION 'qualification_retry_changed' USING ERRCODE='23505';END IF;RETURN prior.result;END IF;
 IF a.selected_partner_offer_id IS NOT NULL OR a.operational_status NOT IN ('NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') THEN RAISE EXCEPTION 'qualification_locked' USING ERRCODE='23514';END IF;
 IF md5(to_jsonb(a)::text)<>p_version THEN RAISE EXCEPTION 'qualification_changed' USING ERRCODE='40001';END IF;
 data:=jsonb_build_object('type',p_type,'answers',p_answers,'source_note',trim(p_note),'recorded_at',clock_timestamp(),'auth_user_id',p_auth,'method','operator_recorded_client_answers');
 UPDATE public.applications SET qualification_data=coalesce(qualification_data,'{}'::jsonb)||jsonb_build_object('operator_qualification',data),updated_at=clock_timestamp() WHERE id=p_id RETURNING jsonb_build_object('application_id',id,'edit_version',md5(to_jsonb(applications)::text)) INTO result;
 INSERT INTO public.audit_events(actor_role,action,entity_type,entity_id,patch,reason,result) VALUES(CASE WHEN p_auth IS NULL THEN 'ADMIN' ELSE 'STAFF' END,'request_qualification_updated','applications',p_id::text,jsonb_build_object('auth_user_id',p_auth,'request_id',p_request,'before',a.qualification_data->'operator_qualification','after',data),'Operator recorded client answers; no booking or price changes','SUCCESS');
 INSERT INTO pcs.request_qualification_commands(application_id,request_id,fingerprint,result) VALUES(p_id,p_request,fingerprint,result);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.save_request_qualification(uuid,text,uuid,text,jsonb,text,uuid) FROM PUBLIC;
