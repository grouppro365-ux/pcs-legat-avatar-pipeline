-- Existing managed Better Auth supplies identity. PCS owns business roles.
CREATE TABLE IF NOT EXISTS pcs.portal_accounts (
 auth_user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id),
 access_id uuid UNIQUE NOT NULL REFERENCES pcs.portal_access(id),
 invitation_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pcs.portal_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pcs.portal_accounts FROM PUBLIC;
CREATE OR REPLACE FUNCTION pcs.portal_bind_account(p_user uuid,p_invitation text,p_new_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE s pcs.portal_access%ROWTYPE; existing pcs.portal_accounts%ROWTYPE;
BEGIN
 IF p_invitation !~ '^[a-f0-9]{64}$' OR p_new_hash !~ '^[a-f0-9]{64}$' OR p_new_hash=p_invitation THEN RAISE EXCEPTION 'portal_invalid_input' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_user AND banned IS NOT TRUE) THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,17));
 SELECT * INTO existing FROM pcs.portal_accounts WHERE auth_user_id=p_user;
 IF FOUND THEN
  IF existing.invitation_hash=p_invitation THEN RETURN jsonb_build_object('ok',true,'bound',true); END IF;
  RAISE EXCEPTION 'portal_account_already_bound' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM pcs.portal_access WHERE token_hash=p_invitation AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pcs.portal_home(p_invitation); -- canonical role/profile availability guard
 INSERT INTO pcs.portal_accounts(auth_user_id,access_id,invitation_hash) VALUES(p_user,s.id,p_invitation);
 -- Consume the invitation; all future access requires the managed identity.
 UPDATE pcs.portal_access SET token_hash=p_new_hash,expires_at=clock_timestamp()+interval '365 days' WHERE id=s.id;
 INSERT INTO audit_events(actor_role,action,entity_type,entity_id,patch,result)
 VALUES('SYSTEM','portal_account_bound','portal_access',s.id::text,jsonb_build_object('auth_user_id',p_user,'role',s.role),'SUCCESS');
 RETURN jsonb_build_object('ok',true,'bound',true,'role',s.role);
END $fn$;
CREATE OR REPLACE FUNCTION pcs.portal_account_hash(p_user uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $fn$
DECLARE h text;
BEGIN
 SELECT a.token_hash INTO h FROM pcs.portal_accounts m JOIN pcs.portal_access a ON a.id=m.access_id
 JOIN neon_auth."user" u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=p_user AND u.banned IS NOT TRUE AND a.revoked_at IS NULL AND a.expires_at>now();
 IF h IS NULL THEN RAISE EXCEPTION 'portal_access_denied' USING ERRCODE='42501'; END IF;
 RETURN h;
END $fn$;
REVOKE ALL ON FUNCTION pcs.portal_bind_account(uuid,text,text),pcs.portal_account_hash(uuid) FROM PUBLIC;
