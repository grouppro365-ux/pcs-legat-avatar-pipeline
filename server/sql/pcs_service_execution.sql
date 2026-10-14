-- Explicit human-confirmed fulfillment facts; finance is independently verified.
CREATE OR REPLACE FUNCTION pcs.confirm_service_execution(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE a public.applications%ROWTYPE; offer public.pcs_partner_offers%ROWTYPE; phase text; slot text; target text; fact jsonb; fingerprint text; result jsonb;
BEGIN
 phase:=p_payload->>'phase';slot:=CASE phase WHEN 'STARTED' THEN 'started' WHEN 'COMPLETED' THEN 'completed' END;
 IF slot IS NULL OR p_payload->>'confirmed' IS DISTINCT FROM 'true' OR length(trim(coalesce(p_payload->>'note',''))) NOT BETWEEN 10 AND 1000 OR coalesce(p_payload->>'request_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'portal_execution_input_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.applications WHERE id=(p_payload->>'application_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_application_not_found' USING ERRCODE='P0002';END IF;
 fingerprint:=md5(p_payload::text);
 fact:=a.qualification_data->'service_execution'->slot;
 IF fact->>'request_id'=p_payload->>'request_id' THEN
  IF fact->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'portal_retry_changed' USING ERRCODE='23505';END IF;
  RETURN (fact->'result')||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(a.qualification_data->'service_execution','{}'::jsonb)) f WHERE f.value->>'request_id'=p_payload->>'request_id') THEN RAISE EXCEPTION 'portal_retry_changed' USING ERRCODE='23505';END IF;
 IF a.updated_at::text IS DISTINCT FROM p_payload->>'expected_version' THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001';END IF;
 IF fact IS NOT NULL OR a.selected_partner_offer_id IS NULL OR a.partner_response_status IS DISTINCT FROM 'ACCEPTED' OR a.assigned_partner_id IS NULL OR coalesce(a.execution_issue_status,'UNKNOWN') NOT IN ('NONE','RESOLVED') THEN RAISE EXCEPTION 'portal_execution_not_available' USING ERRCODE='23514';END IF;
 SELECT * INTO offer FROM public.pcs_partner_offers WHERE id=a.selected_partner_offer_id AND application_id=a.id AND status='ACCEPTED' AND partner_id=a.assigned_partner_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.pcs_workflow_outbox WHERE aggregate_id=a.id AND event_type='CLIENT_BOOKING_CONFIRMED' AND payload->>'selected_offer_id'=a.selected_partner_offer_id::text) THEN RAISE EXCEPTION 'portal_execution_confirmation_missing' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM public.catalog_items WHERE id=a.item_id AND entity_type='VEHICLE') OR EXISTS(SELECT 1 FROM public.catalog_items WHERE id=offer.catalog_item_id AND entity_type='VEHICLE') THEN RAISE EXCEPTION 'portal_execution_vehicle_forbidden' USING ERRCODE='23514';END IF;
 IF (phase='STARTED' AND a.operational_status NOT IN ('CONFIRMED','SERVICE_IN_PROGRESS')) OR (phase='COMPLETED' AND (a.operational_status<>'SERVICE_IN_PROGRESS' OR a.qualification_data#>'{service_execution,started}' IS NULL)) THEN RAISE EXCEPTION 'portal_execution_not_available' USING ERRCODE='23514';END IF;
 target:=CASE phase WHEN 'STARTED' THEN 'SERVICE_IN_PROGRESS' ELSE 'COMPLETED' END;
 result:=jsonb_build_object('ok',true,'application_id',a.id,'status',target);
 fact:=jsonb_build_object('request_id',p_payload->>'request_id','fingerprint',fingerprint,'note',trim(p_payload->>'note'),'confirmed_at',clock_timestamp(),'result',result);
 PERFORM set_config('pcs.service_execution_write',md5((coalesce(a.qualification_data->'service_execution','{}'::jsonb)||jsonb_build_object(slot,fact))::text),true);
 UPDATE public.applications SET operational_status=target,qualification_data=coalesce(qualification_data,'{}'::jsonb)||jsonb_build_object('service_execution',coalesce(qualification_data->'service_execution','{}'::jsonb)||jsonb_build_object(slot,fact)),
  next_action_code=CASE WHEN phase='STARTED' THEN 'VERIFY_SERVICE_COMPLETION' WHEN client_payment_status='PAID_TO_PARTNER' THEN 'ARCHIVE_COMPLETED_SERVICE' ELSE 'VERIFY_FINAL_PAYMENT' END,updated_at=clock_timestamp() WHERE id=a.id;
 PERFORM set_config('pcs.service_execution_write','',true);
 INSERT INTO public.audit_events(actor_role,action,entity_type,entity_id,patch,reason,result) VALUES('ADMIN','service.execution.'||lower(phase),'applications',a.id::text,jsonb_build_object('previous_status',a.operational_status,'status',target,'request_id',p_payload->>'request_id','payment_status',a.client_payment_status),trim(p_payload->>'note'),'SUCCESS');
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.confirm_service_execution(jsonb) FROM PUBLIC;
-- No new identities/roles: execution permission is limited to the existing operational roles.
INSERT INTO pcs.role_permissions(role,permission,scope) VALUES('OPS_ADMIN','applications.execute','GLOBAL'),('CONCIERGE_MANAGER','applications.execute','GLOBAL') ON CONFLICT DO NOTHING;
-- Future late-stage instructions only; existing completed conversations are not backfilled.
INSERT INTO public.system_settings(key,value,updated_at) VALUES('late_payment_instructions',jsonb_build_object('enabled_from',clock_timestamp()),now()) ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION pcs.guard_service_execution_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE authorized boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.qualification_data->'service_execution' IS NOT NULL THEN RAISE EXCEPTION 'portal_execution_facts_locked' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 authorized:=current_setting('pcs.service_execution_write',true)=md5(coalesce(NEW.qualification_data->'service_execution','{}'::jsonb)::text);
 IF NEW.qualification_data->'service_execution' IS DISTINCT FROM OLD.qualification_data->'service_execution' AND authorized IS NOT TRUE THEN RAISE EXCEPTION 'portal_execution_facts_locked' USING ERRCODE='23514';END IF;
 IF coalesce(OLD.selected_partner_offer_id,NEW.selected_partner_offer_id) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.catalog_items WHERE id=OLD.item_id AND entity_type='VEHICLE') AND NOT EXISTS(SELECT 1 FROM public.pcs_partner_offers o JOIN public.catalog_items c ON c.id=o.catalog_item_id WHERE o.id=coalesce(OLD.selected_partner_offer_id,NEW.selected_partner_offer_id) AND c.entity_type='VEHICLE') AND NEW.operational_status IS DISTINCT FROM OLD.operational_status THEN
  IF NEW.operational_status IN ('SERVICE_IN_PROGRESS','COMPLETED') AND authorized IS NOT TRUE THEN RAISE EXCEPTION 'portal_execution_confirmation_required' USING ERRCODE='23514';END IF;
  IF OLD.qualification_data#>'{service_execution,started}' IS NOT NULL AND NEW.operational_status NOT IN ('SERVICE_IN_PROGRESS','COMPLETED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER') THEN RAISE EXCEPTION 'portal_execution_reopen_forbidden' USING ERRCODE='23514';END IF;
  IF OLD.operational_status='COMPLETED' THEN RAISE EXCEPTION 'portal_execution_reopen_forbidden' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pcs.guard_service_execution_facts() FROM PUBLIC;
CREATE OR REPLACE TRIGGER pcs_service_execution_facts BEFORE INSERT OR UPDATE OF qualification_data,operational_status ON public.applications FOR EACH ROW EXECUTE FUNCTION pcs.guard_service_execution_facts();
