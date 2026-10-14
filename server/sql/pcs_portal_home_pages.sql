-- Bounded, scoped application browsing. Offset pages reflect current rows, not a frozen snapshot.
CREATE OR REPLACE FUNCTION pcs.portal_home_page(p_hash text,p_page integer,p_view text,p_search text) RETURNS jsonb LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $fn$
DECLARE s pcs.portal_access%ROWTYPE; apps jsonb; offers jsonb; payments jsonb; vehicles jsonb; more boolean; terminal text[]:=ARRAY['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'];
BEGIN
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 5000 OR p_view IS NULL OR p_view NOT IN ('all','active','completed') OR p_search IS NULL OR length(p_search)>120 THEN RAISE EXCEPTION 'portal_page_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM pcs.portal_access WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='CLIENT' AND NOT EXISTS(SELECT 1 FROM client_profiles WHERE id=s.client_profile_id AND blocked IS NOT TRUE AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 IF s.role='PARTNER' AND NOT EXISTS(SELECT 1 FROM partners WHERE id=s.partner_id AND status='ACTIVE') THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.id),'[]') INTO apps FROM (
  SELECT a.id,a.public_id,a.category,a.city,a.operational_status,a.partner_response_status,a.client_payment_status,
   a.selected_partner_offer_id,a.updated_at,a.updated_at::text edit_version,
   CASE WHEN s.role='CLIENT' THEN a.client_visible_notes ELSE a.partner_visible_notes END notes,
   a.accepted_offer_snapshot->>'client_price_thb' agreed_price_thb,
   coalesce(a.accepted_offer_snapshot#>>'{availability_snapshot,booking_quantity}','1') booking_quantity,a.accepted_offer_snapshot#>>'{availability_snapshot,booking,start_date}' start_date,a.accepted_offer_snapshot#>>'{availability_snapshot,booking,end_date}' end_date,
   a.accepted_offer_snapshot->>'deposit_thb' deposit_thb,a.accepted_offer_snapshot->>'terms' agreed_terms,
   i.instructions payment_instructions,i.recipient payment_recipient,
   (SELECT to_jsonb(b) FROM pcs.application_service_balance(a.id) b) payment_balance
  FROM applications a LEFT JOIN pcs.application_payment_instructions i ON i.application_id=a.id
  WHERE ((s.role='CLIENT' AND a.client_profile_id=s.client_profile_id) OR (s.role='PARTNER' AND a.assigned_partner_id=s.partner_id))
   AND (p_view='all' OR (p_view='active' AND a.operational_status<>ALL(terminal)) OR (p_view='completed' AND a.operational_status=ANY(terminal)))
   AND (trim(p_search)='' OR strpos(lower(coalesce(a.public_id,'')||' '||coalesce(a.city,'')||' '||coalesce(CASE WHEN s.role='CLIENT' THEN a.client_visible_notes ELSE a.partner_visible_notes END,'')),lower(trim(p_search)))>0)
  ORDER BY a.updated_at DESC,a.id LIMIT 101 OFFSET p_page*100
 ) x;
 more:=jsonb_array_length(apps)>100;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]') INTO apps FROM jsonb_array_elements(apps) WITH ORDINALITY e(value,ordinal) WHERE ordinal<=100;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO offers FROM (
  SELECT o.id,o.application_id,o.partner_id,o.status,o.client_price_thb::text,o.deposit_thb::text,o.terms,o.expires_at,
   o.updated_at::text edit_version,p.public_name partner_name,coalesce(o.public_snapshot->>'title',c.title) item_title,o.catalog_item_id,coalesce(o.availability_snapshot->>'booking_quantity','1') booking_quantity,
   o.availability_snapshot#>>'{booking,start_date}' start_date,o.availability_snapshot#>>'{booking,end_date}' end_date
  FROM pcs_partner_offers o JOIN applications a ON a.id=o.application_id JOIN partners p ON p.id=o.partner_id LEFT JOIN catalog_items c ON c.id=o.catalog_item_id
  WHERE a.id IN (SELECT (v->>'id')::uuid FROM jsonb_array_elements(apps) v)
   AND ((s.role='CLIENT' AND a.client_profile_id=s.client_profile_id AND o.status IN ('APPROVED','ACCEPTED') AND (o.expires_at IS NULL OR o.expires_at>now() OR o.status='ACCEPTED'))
     OR (s.role='PARTNER' AND o.partner_id=s.partner_id AND a.assigned_partner_id=s.partner_id))
  ORDER BY o.created_at DESC,o.id LIMIT 500
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO payments FROM (
  SELECT c.id,c.application_id,c.amount_thb::text,c.reference,c.status,c.review_note,c.created_at
  FROM pcs.application_payment_claims c WHERE c.application_id IN (SELECT (v->>'id')::uuid FROM jsonb_array_elements(apps) v)
  ORDER BY c.created_at DESC,c.id LIMIT 500
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO vehicles FROM (SELECT id,title,entity_type FROM catalog_items WHERE s.role='PARTNER' AND owner_partner_id=s.partner_id AND (entity_type='VEHICLE' OR entity_type IN ('PROPERTY','SERVICE') AND booking_capacity IS NOT NULL) AND publication_status='PUBLISHED' AND moderation_status='APPROVED' AND availability_status='AVAILABLE' ORDER BY title,id LIMIT 500) x;
 RETURN jsonb_build_object('vehicles',vehicles,'role',s.role,'expires_at',s.expires_at,'applications',apps,'offers',offers,'payments',payments,'limit',100,'page',p_page,'view',p_view,'q',trim(p_search),'has_more',more);
END $fn$;
REVOKE ALL ON FUNCTION pcs.portal_home_page(text,integer,text,text) FROM PUBLIC;
