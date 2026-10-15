-- Scoped read-only history; full service balance remains independent of the displayed page.
CREATE OR REPLACE FUNCTION pcs.portal_application_history(p_hash text,p_application uuid,p_kind text,p_page integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE s pcs.portal_access%ROWTYPE; app public.applications%ROWTYPE; records jsonb; more boolean; balance jsonb;
BEGIN
 IF p_application IS NULL OR p_kind IS NULL OR p_kind NOT IN ('offers','payments') OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 5000 THEN RAISE EXCEPTION 'portal_history_input_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM pcs.portal_access WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='CLIENT' AND NOT EXISTS(SELECT 1 FROM client_profiles WHERE id=s.client_profile_id AND blocked IS NOT TRUE AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='PARTNER' AND NOT EXISTS(SELECT 1 FROM partners WHERE id=s.partner_id AND status='ACTIVE') THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO app FROM public.applications WHERE id=p_application AND ((s.role='CLIENT' AND client_profile_id=s.client_profile_id) OR (s.role='PARTNER' AND assigned_partner_id=s.partner_id));
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_application_not_found' USING ERRCODE='P0002';END IF;
 IF p_kind='offers' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO records FROM (
  SELECT o.created_at,o.id,o.application_id,o.partner_id,o.status,o.client_price_thb::text,o.deposit_thb::text,o.terms,o.expires_at,
   o.updated_at::text edit_version,p.public_name partner_name,coalesce(o.public_snapshot->>'title',c.title) item_title,o.catalog_item_id,coalesce(o.availability_snapshot->>'booking_quantity','1') booking_quantity,
   o.availability_snapshot#>>'{booking,start_date}' start_date,o.availability_snapshot#>>'{booking,end_date}' end_date
  FROM pcs_partner_offers o JOIN applications a ON a.id=o.application_id JOIN partners p ON p.id=o.partner_id LEFT JOIN catalog_items c ON c.id=o.catalog_item_id
  WHERE a.id=p_application
   AND ((s.role='CLIENT' AND a.client_profile_id=s.client_profile_id AND ((o.status IN ('APPROVED','ACCEPTED') AND (o.expires_at IS NULL OR o.expires_at>now() OR o.status='ACCEPTED')) OR (o.status='WITHDRAWN' AND o.public_snapshot->>'withdrawn_public'='true')))
     OR (s.role='PARTNER' AND o.partner_id=s.partner_id AND a.assigned_partner_id=s.partner_id))
  ORDER BY o.created_at DESC,o.id LIMIT 101 OFFSET p_page*100
 ) x;
 ELSE
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO records FROM (
  SELECT c.id,c.application_id,c.amount_thb::text,c.reference,c.status,c.review_note,c.created_at
  FROM pcs.application_payment_claims c WHERE c.application_id=p_application
  ORDER BY c.created_at DESC,c.id LIMIT 101 OFFSET p_page*100
 ) x;
 END IF;
 more:=jsonb_array_length(records)>100;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]') INTO records FROM jsonb_array_elements(records) WITH ORDINALITY e(value,ordinal) WHERE ordinal<=100;
 SELECT to_jsonb(b) INTO balance FROM pcs.application_service_balance(p_application) b;
 RETURN jsonb_build_object('application_id',app.id,'public_id',app.public_id,'role',s.role,'history',p_kind,'page',p_page,'limit',100,'has_more',more,'rows',records,'payment_balance',balance);
END $fn$;
REVOKE ALL ON FUNCTION pcs.portal_application_history(text,uuid,text,integer) FROM PUBLIC;
