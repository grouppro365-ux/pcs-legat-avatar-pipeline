-- Scoped cabinet links; canonical applications/offers remain in the existing CRM.
CREATE TABLE IF NOT EXISTS pcs.portal_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text UNIQUE NOT NULL,
 role text NOT NULL CHECK(role IN ('CLIENT','PARTNER')),
 client_profile_id uuid REFERENCES public.client_profiles(id), partner_id uuid REFERENCES public.partners(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role='CLIENT' AND client_profile_id IS NOT NULL AND partner_id IS NULL) OR
        (role='PARTNER' AND partner_id IS NOT NULL AND client_profile_id IS NULL))
);
CREATE TABLE IF NOT EXISTS pcs.portal_commands (
 access_id uuid REFERENCES pcs.portal_access(id), request_id uuid,
 fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(access_id,request_id)
);
CREATE TABLE IF NOT EXISTS pcs.application_payment_instructions (
 application_id uuid PRIMARY KEY REFERENCES public.applications(id),
 recipient text NOT NULL CHECK(recipient='PARTNER'), instructions text NOT NULL CHECK(length(instructions) BETWEEN 1 AND 4000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pcs.application_payment_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES public.applications(id),
 client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id), amount_thb numeric(14,2) NOT NULL CHECK(amount_thb>0),
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED')),
 review_note text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_claims_application_idx ON pcs.application_payment_claims(application_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS portal_claim_reference_idx ON pcs.application_payment_claims(application_id,lower(reference)) WHERE status<>'REJECTED';
ALTER TABLE pcs.portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcs.portal_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcs.application_payment_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcs.application_payment_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pcs.portal_access,pcs.portal_commands,pcs.application_payment_instructions,pcs.application_payment_claims FROM PUBLIC;

CREATE OR REPLACE FUNCTION pcs.portal_home(p_hash text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $fn$
BEGIN
 RETURN pcs.portal_home_page(p_hash,0,'all','');
END $fn$;

CREATE OR REPLACE FUNCTION pcs.portal_action(p_hash text,p_action text,p_request uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $fn$
DECLARE s pcs.portal_access%ROWTYPE; a applications%ROWTYPE; previous pcs.portal_commands%ROWTYPE;
 result jsonb; fingerprint text; new_id uuid; profile client_profiles%ROWTYPE; total numeric; vehicle public.catalog_items%ROWTYPE; booking jsonb;
BEGIN
 SELECT * INTO s FROM pcs.portal_access WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='CLIENT' AND NOT EXISTS(SELECT 1 FROM client_profiles WHERE id=s.client_profile_id AND blocked IS NOT TRUE AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='PARTNER' AND NOT EXISTS(SELECT 1 FROM partners WHERE id=s.partner_id AND status='ACTIVE') THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
 -- Serialise retries before reading the command receipt, including create-request retries.
 PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text||':'||p_request::text,0));
 fingerprint:=encode(digest(p_action||':'||p_payload::text,'sha256'),'hex');
 SELECT * INTO previous FROM pcs.portal_commands WHERE access_id=s.id AND request_id=p_request;
 IF FOUND THEN IF previous.fingerprint<>fingerprint THEN RAISE EXCEPTION 'portal_retry_changed' USING ERRCODE='23505'; END IF; RETURN previous.result; END IF;
 IF p_action='request' AND s.role='CLIENT' THEN
  IF length(trim(coalesce(p_payload->>'need',''))) NOT BETWEEN 1 AND 4000 OR length(coalesce(p_payload->>'city',''))>200 THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
  SELECT * INTO profile FROM client_profiles WHERE id=s.client_profile_id;
  INSERT INTO applications(public_id,client_profile_id,client_name,client_contact,category,city,client_visible_notes,source_code,operational_status,human_review_required,next_action_code)
  VALUES('APP-'||replace(gen_random_uuid()::text,'-',''),s.client_profile_id,profile.display_name,profile.contact,'general',nullif(trim(p_payload->>'city'),''),trim(p_payload->>'need'),'CLIENT_PORTAL','NEW',true,'QUALIFY_REQUEST') RETURNING id INTO new_id;
  result:=jsonb_build_object('ok',true,'application_id',new_id,'status','NEW');
 ELSE
  SELECT * INTO a FROM applications WHERE id=(p_payload->>'application_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT ((s.role='CLIENT' AND a.client_profile_id=s.client_profile_id) OR (s.role='PARTNER' AND a.assigned_partner_id=s.partner_id)) THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
  IF coalesce(p_payload->>'expected_version','')<>a.updated_at::text THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001'; END IF;
  IF p_action='submit-offer' AND s.role='PARTNER' THEN
   IF a.operational_status NOT IN ('NEW','TRIAGE','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') OR a.selected_partner_offer_id IS NOT NULL THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   IF coalesce(p_payload->>'price','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' OR (p_payload->>'price')::numeric<=0 OR coalesce(p_payload->>'deposit','0') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' OR length(trim(coalesce(p_payload->>'terms',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
   booking:='{}'::jsonb;vehicle:=NULL;
   IF nullif(p_payload->>'catalog_item_id','') IS NOT NULL THEN
    SELECT * INTO vehicle FROM catalog_items WHERE id=(p_payload->>'catalog_item_id')::uuid AND owner_partner_id=s.partner_id AND (entity_type='VEHICLE' OR entity_type IN ('PROPERTY','SERVICE') AND booking_capacity IS NOT NULL) AND publication_status='PUBLISHED' AND moderation_status='APPROVED' AND availability_status='AVAILABLE' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'portal_vehicle_unavailable' USING ERRCODE='42501';END IF;
    booking:=pcs.vehicle_offer_booking(p_payload->>'start_date',p_payload->>'end_date');
    IF coalesce(nullif(p_payload->>'booking_quantity',''),'1') !~ '^[1-9][0-9]{0,4}$' OR vehicle.entity_type='VEHICLE' AND coalesce(nullif(p_payload->>'booking_quantity',''),'1')<>'1' THEN RAISE EXCEPTION 'resource_booking_invalid' USING ERRCODE='22023';END IF;
    booking:=booking||jsonb_build_object('booking_quantity',coalesce(nullif(p_payload->>'booking_quantity',''),'1'));
   ELSIF nullif(p_payload->>'start_date','') IS NOT NULL OR nullif(p_payload->>'end_date','') IS NOT NULL OR coalesce(nullif(p_payload->>'booking_quantity',''),'1')<>'1' THEN RAISE EXCEPTION 'portal_vehicle_dates_without_vehicle' USING ERRCODE='22023';END IF;
   INSERT INTO pcs_partner_offers(application_id,partner_id,catalog_item_id,status,client_price_thb,deposit_thb,terms,public_snapshot,availability_snapshot,submitted_at,expires_at)
   VALUES(a.id,s.partner_id,vehicle.id,'SUBMITTED',(p_payload->>'price')::numeric,coalesce(p_payload->>'deposit','0')::numeric,trim(p_payload->>'terms'),CASE WHEN vehicle.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('title',vehicle.title,'entity_type',vehicle.entity_type) END,booking,now(),now()+interval '7 days') RETURNING id INTO new_id;
   UPDATE applications SET human_review_required=true,next_action_code='REVIEW_PARTNER_OFFER',updated_at=clock_timestamp() WHERE id=a.id;
   result:=jsonb_build_object('ok',true,'offer_id',new_id,'status','SUBMITTED');
  ELSIF p_action='select-offer' AND s.role='CLIENT' THEN
   IF a.operational_status NOT IN ('NEW','TRIAGE','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   PERFORM 1 FROM partners p JOIN pcs_partner_offers o ON o.partner_id=p.id WHERE o.id=(p_payload->>'offer_id')::uuid AND o.application_id=a.id AND p.status='ACTIVE' FOR SHARE OF p;
   IF NOT FOUND THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   result:=pcs.accept_partner_offer(a.id,(p_payload->>'offer_id')::uuid,s.client_profile_id);
  ELSIF p_action IN ('confirm','decline') AND s.role='PARTNER' THEN
   result:=pcs.partner_decide_selected_offer(a.id,s.partner_id,p_action='confirm');
  ELSIF p_action='confirm' AND s.role='CLIENT' THEN
   result:=pcs.client_confirm_selected_offer(a.id,s.client_profile_id);
   UPDATE applications SET client_payment_status='AWAITING_PAYMENT',updated_at=clock_timestamp() WHERE id=a.id;
  ELSIF p_action='payment' AND s.role='CLIENT' THEN
   IF a.operational_status NOT IN ('CONFIRMED','SERVICE_IN_PROGRESS','COMPLETED') OR a.client_payment_status NOT IN ('AWAITING_PAYMENT','PARTIALLY_PAID','INSTRUCTIONS_SENT') OR NOT EXISTS(SELECT 1 FROM pcs.application_payment_instructions WHERE application_id=a.id) THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   IF coalesce(p_payload->>'amount','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' OR (p_payload->>'amount')::numeric<=0 OR length(trim(coalesce(p_payload->>'reference',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
   INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference) VALUES(a.id,s.client_profile_id,(p_payload->>'amount')::numeric,trim(p_payload->>'reference')) RETURNING id INTO new_id;
   UPDATE applications SET human_review_required=true,next_action_code='VERIFY_PAYMENT',updated_at=clock_timestamp() WHERE id=a.id;
   result:=jsonb_build_object('ok',true,'claim_id',new_id,'status','PENDING');
  ELSE RAISE EXCEPTION 'portal_action_forbidden' USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO pcs.portal_commands(access_id,request_id,fingerprint,result) VALUES(s.id,p_request,fingerprint,result);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('PORTAL_'||s.role,'portal.'||p_action,'applications',coalesce(a.id,new_id)::text,jsonb_build_object('access_id',s.id,'request_id',p_request),'SUCCESS');
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.portal_home(text),pcs.portal_action(text,text,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION pcs.portal_admin_action(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $fn$
DECLARE a applications%ROWTYPE; o pcs_partner_offers%ROWTYPE; c pcs.application_payment_claims%ROWTYPE;
 idv uuid; total numeric; expected numeric; new_status text; result jsonb;
BEGIN
 IF p_action='execution-issue' THEN RETURN pcs.manage_execution_issue(p_payload);END IF;
 IF p_action='service-phase' THEN RETURN pcs.confirm_service_execution(p_payload);END IF;
 IF p_action='issue-access' THEN
  IF p_payload->>'role'='CLIENT' AND EXISTS(SELECT 1 FROM client_profiles WHERE id=(p_payload->>'profile_id')::uuid AND blocked IS NOT TRUE AND merged_into_id IS NULL) THEN
   INSERT INTO pcs.portal_access(token_hash,role,client_profile_id,expires_at) VALUES(p_payload->>'hash','CLIENT',(p_payload->>'profile_id')::uuid,now()+interval '7 days') RETURNING id INTO idv;
  ELSIF p_payload->>'role'='PARTNER' AND EXISTS(SELECT 1 FROM partners WHERE id=(p_payload->>'profile_id')::uuid AND status='ACTIVE') THEN
   INSERT INTO pcs.portal_access(token_hash,role,partner_id,expires_at) VALUES(p_payload->>'hash','PARTNER',(p_payload->>'profile_id')::uuid,now()+interval '7 days') RETURNING id INTO idv;
  ELSE RAISE EXCEPTION 'portal_invalid_profile' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('ok',true,'access_id',idv);
 ELSIF p_action='revoke-access' THEN
  UPDATE pcs.portal_access SET revoked_at=clock_timestamp() WHERE id=(p_payload->>'access_id')::uuid RETURNING id INTO idv;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal_access_not_found' USING ERRCODE='P0002'; END IF;
  result:=jsonb_build_object('ok',true,'access_id',idv);
 ELSE
  SELECT * INTO a FROM applications WHERE id=(p_payload->>'application_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal_application_not_found' USING ERRCODE='P0002'; END IF;
  IF coalesce(p_payload->>'expected_version','')<>a.updated_at::text THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001'; END IF;
  IF p_action='assign-partner' THEN
   IF a.selected_partner_offer_id IS NOT NULL OR a.operational_status NOT IN ('NEW','TRIAGE','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM partners WHERE id=(p_payload->>'partner_id')::uuid AND status='ACTIVE') THEN RAISE EXCEPTION 'portal_invalid_profile' USING ERRCODE='22023'; END IF;
   UPDATE applications SET assigned_partner_id=(p_payload->>'partner_id')::uuid,operational_status='MATCHING',updated_at=clock_timestamp() WHERE id=a.id;
  ELSIF p_action='review-offer' THEN
   SELECT * INTO o FROM pcs_partner_offers WHERE id=(p_payload->>'offer_id')::uuid AND application_id=a.id FOR UPDATE;
   IF NOT FOUND OR o.status<>'SUBMITTED' OR o.updated_at::text<>coalesce(p_payload->>'offer_version','') OR a.selected_partner_offer_id IS NOT NULL OR o.partner_id IS DISTINCT FROM a.assigned_partner_id OR o.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM partners WHERE id=o.partner_id AND status='ACTIVE') THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001'; END IF;
   IF a.operational_status NOT IN ('NEW','TRIAGE','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION') THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   IF p_payload->>'decision' NOT IN ('APPROVED','REJECTED') OR p_payload->>'decision' IS NULL THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
   UPDATE pcs_partner_offers SET status=p_payload->>'decision',reviewed_at=now(),updated_at=clock_timestamp() WHERE id=o.id;
   UPDATE applications SET operational_status=CASE WHEN p_payload->>'decision'='APPROVED' THEN 'QUOTE_READY' ELSE operational_status END,updated_at=clock_timestamp() WHERE id=a.id;
  ELSIF p_action='payment-instructions' THEN
   IF a.operational_status NOT IN ('CONFIRMED','SERVICE_IN_PROGRESS','COMPLETED') OR a.selected_partner_offer_id IS NULL OR NOT EXISTS(SELECT 1 FROM partners WHERE id=a.assigned_partner_id AND client_payment_recipient='PARTNER' AND pcs_collects_client_payment IS NOT TRUE) THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
   IF length(trim(coalesce(p_payload->>'instructions',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
   INSERT INTO pcs.application_payment_instructions(application_id,recipient,instructions) VALUES(a.id,'PARTNER',trim(p_payload->>'instructions')) ON CONFLICT(application_id) DO UPDATE SET instructions=excluded.instructions,updated_at=clock_timestamp();
   UPDATE applications SET client_payment_status=CASE WHEN client_payment_status IN ('NOT_REQUIRED_YET','AWAITING_PAYMENT','INSTRUCTIONS_SENT') THEN 'INSTRUCTIONS_SENT' ELSE client_payment_status END,updated_at=clock_timestamp() WHERE id=a.id;
  ELSIF p_action='review-payment' THEN
   SELECT * INTO c FROM pcs.application_payment_claims WHERE id=(p_payload->>'claim_id')::uuid AND application_id=a.id FOR UPDATE;
   IF NOT FOUND OR c.status<>'PENDING' OR c.updated_at::text<>coalesce(p_payload->>'claim_version','') THEN RAISE EXCEPTION 'portal_version_conflict' USING ERRCODE='40001'; END IF;
   IF a.operational_status NOT IN ('CONFIRMED','SERVICE_IN_PROGRESS','COMPLETED') OR p_payload->>'decision' NOT IN ('VERIFIED','REJECTED') OR p_payload->>'decision' IS NULL OR length(trim(coalesce(p_payload->>'note',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
   IF p_payload->>'decision'='VERIFIED' THEN
    IF NOT EXISTS(SELECT 1 FROM pcs.application_payment_instructions WHERE application_id=a.id AND recipient='PARTNER') THEN RAISE EXCEPTION 'portal_invalid_state' USING ERRCODE='23514'; END IF;
    expected:=(a.accepted_offer_snapshot->>'client_price_thb')::numeric;
    SELECT coalesce(sum(amount_thb),0)+c.amount_thb INTO total FROM pcs.application_payment_claims WHERE application_id=a.id AND status='VERIFIED';
    IF expected IS NULL OR expected<=0 OR total>expected THEN RAISE EXCEPTION 'portal_payment_exceeds_price' USING ERRCODE='23514'; END IF;
    new_status:=CASE WHEN total=expected THEN 'PAID_TO_PARTNER' ELSE 'PARTIALLY_PAID' END;
   ELSE new_status:=a.client_payment_status; END IF;
   UPDATE pcs.application_payment_claims SET status=p_payload->>'decision',review_note=trim(p_payload->>'note'),reviewed_at=now(),updated_at=clock_timestamp() WHERE id=c.id;
   UPDATE applications SET client_payment_status=new_status,next_action_code=CASE WHEN new_status='PAID_TO_PARTNER' AND a.operational_status='COMPLETED' THEN 'ARCHIVE_COMPLETED_SERVICE' WHEN new_status='PAID_TO_PARTNER' AND a.operational_status='SERVICE_IN_PROGRESS' THEN 'VERIFY_SERVICE_COMPLETION' WHEN new_status='PAID_TO_PARTNER' THEN 'PREPARE_SERVICE' ELSE next_action_code END,updated_at=clock_timestamp() WHERE id=a.id;
  ELSE RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='22023'; END IF;
  idv:=a.id;result:=jsonb_build_object('ok',true,'application_id',a.id);
 END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('ADMIN','portal.admin.'||p_action,CASE WHEN p_action IN ('issue-access','revoke-access') THEN 'portal_access' ELSE 'applications' END,idv::text,p_payload-'hash','SUCCESS');
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.portal_admin_action(text,jsonb) FROM PUBLIC;
