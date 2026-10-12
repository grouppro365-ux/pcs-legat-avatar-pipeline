-- Managed identity + existing PCS global memberships. No public grants or JWT roles.
CREATE OR REPLACE FUNCTION pcs.staff_context(p_auth uuid) RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object('user_id',u.id,'name',u.display_name,'roles',coalesce((SELECT jsonb_agg(DISTINCT m.role) FROM memberships m WHERE m.user_id=u.id AND m.active AND m.partner_id IS NULL),'[]'::jsonb),'permissions',coalesce((SELECT jsonb_agg(DISTINCT rp.permission) FROM memberships m JOIN pcs.role_permissions rp ON rp.role=m.role AND rp.scope='GLOBAL' WHERE m.user_id=u.id AND m.active AND m.partner_id IS NULL),'[]'::jsonb))
 FROM app_users u JOIN neon_auth."user" n ON n.id::text=u.external_id
 WHERE n.id=p_auth AND n.banned IS NOT TRUE AND u.active
 AND EXISTS(SELECT 1 FROM memberships m JOIN pcs.role_permissions rp ON rp.role=m.role AND rp.scope='GLOBAL' WHERE m.user_id=u.id AND m.active AND m.partner_id IS NULL)
$fn$;
REVOKE ALL ON FUNCTION pcs.staff_context(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.staff_manage(p_auth uuid,p_role text,p_active boolean) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $fn$
DECLARE uid uuid; label text;
BEGIN
 IF p_role NOT IN ('OPS_ADMIN','CONCIERGE_MANAGER','CATALOG_MANAGER','FINANCE_RECONCILIATION','AUDITOR_READONLY','PARTNERSHIP_MANAGER') OR p_active IS NULL THEN RAISE EXCEPTION 'staff_invalid_input' USING ERRCODE='22023'; END IF;
 SELECT name INTO label FROM neon_auth."user" WHERE id=p_auth AND banned IS NOT TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff_identity_missing' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_auth::text,29));
 SELECT id INTO uid FROM app_users WHERE external_id=p_auth::text FOR UPDATE;
 IF EXISTS(SELECT 1 FROM memberships WHERE user_id=uid AND active AND role IN ('OWNER','SUPER_ADMIN')) THEN RAISE EXCEPTION 'staff_owner_protected' USING ERRCODE='42501'; END IF;
 IF uid IS NULL THEN
  IF NOT p_active THEN RAISE EXCEPTION 'staff_identity_missing' USING ERRCODE='42501'; END IF;
  INSERT INTO app_users(external_id,display_name,active) VALUES(p_auth::text,label,true) RETURNING id INTO uid;
 END IF;
 UPDATE app_users SET active=p_active WHERE id=uid;
 UPDATE memberships SET active=false WHERE user_id=uid AND partner_id IS NULL;
 IF p_active THEN
  UPDATE memberships SET active=true WHERE user_id=uid AND partner_id IS NULL AND role=p_role;
  IF NOT FOUND THEN INSERT INTO memberships(user_id,role,active) VALUES(uid,p_role,true); END IF;
 END IF;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('ADMIN','staff.access_changed','app_users',uid::text,jsonb_build_object('auth_user_id',p_auth,'role',p_role,'active',p_active),'SUCCESS');
 RETURN jsonb_build_object('ok',true,'user_id',uid);
END $fn$;
REVOKE ALL ON FUNCTION pcs.staff_manage(uuid,text,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.staff_workflow_action(p_auth uuid,p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb; required text; result jsonb;
BEGIN
 ctx:=pcs.staff_context(p_auth);
 required:=CASE WHEN p_action IN ('assign-partner','issue-access','revoke-access') THEN 'applications.assign' WHEN p_action='review-offer' THEN 'applications.quote' WHEN p_action IN ('payment-instructions','review-payment') THEN 'settlements.edit' END;
 IF ctx IS NULL OR required IS NULL OR NOT (ctx->'permissions' ? required OR ctx->'permissions' ? '*') THEN RAISE EXCEPTION 'staff_action_forbidden' USING ERRCODE='42501'; END IF;
 result:=pcs.portal_admin_action(p_action,p_payload);
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result) VALUES('STAFF','staff.workflow.'||p_action,'app_users',ctx->>'user_id',jsonb_build_object('auth_user_id',p_auth,'application_id',p_payload->>'application_id','access_id',p_payload->>'access_id'),'SUCCESS');
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pcs.staff_workflow_action(uuid,text,jsonb) FROM PUBLIC;
-- Start future notifications once, without backfilling previous real conversations.
INSERT INTO public.system_settings(key,value,updated_at) VALUES('workflow_client_delivery',jsonb_build_object('enabled_from',clock_timestamp()),now()) ON CONFLICT(key) DO NOTHING;
