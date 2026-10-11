-- Inside a rollback block after both migrations; synthetic identities only.
INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned)
VALUES(u,'QA identity','pcs-qa-'||u::text||'@example.invalid',false,now(),now(),false),
 (other_u,'QA other','pcs-qa-'||other_u::text||'@example.invalid',false,now(),now(),false);
INSERT INTO client_profiles(id,display_name,contact) VALUES(client,'QA client','QA only');
PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','CLIENT','profile_id',client,'hash',invite));
SELECT id INTO access FROM pcs.portal_access WHERE token_hash=invite;
PERFORM pcs.portal_bind_account(u,invite,fresh);
IF (pcs.portal_home(pcs.portal_account_hash(u))->>'role')<>'CLIENT' THEN RAISE EXCEPTION 'QA wrong role'; END IF;
IF (SELECT expires_at FROM pcs.portal_access WHERE id=access)<now()+interval '364 days' THEN RAISE EXCEPTION 'QA missing account expiry'; END IF;
PERFORM pcs.portal_bind_account(u,invite,fresh); -- same-user receipt recovery
BEGIN PERFORM pcs.portal_home(invite);RAISE EXCEPTION 'QA invitation still reusable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM pcs.portal_bind_account(other_u,invite,repeat('c',64));RAISE EXCEPTION 'QA stolen invitation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
BEGIN PERFORM pcs.portal_account_hash(other_u);RAISE EXCEPTION 'QA unbound user access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
UPDATE neon_auth."user" SET banned=true WHERE id=u;
BEGIN PERFORM pcs.portal_account_hash(u);RAISE EXCEPTION 'QA banned identity access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
UPDATE neon_auth."user" SET banned=false WHERE id=u;
PERFORM pcs.portal_admin_action('revoke-access',jsonb_build_object('access_id',access));
BEGIN PERFORM pcs.portal_account_hash(u);RAISE EXCEPTION 'QA revoked access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
