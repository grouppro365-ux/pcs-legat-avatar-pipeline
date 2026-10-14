DECLARE client uuid:=gen_random_uuid();other_client uuid:=gen_random_uuid();partner uuid:=gen_random_uuid();app uuid:=gen_random_uuid();other_app uuid:=gen_random_uuid();unknown_app uuid:=gen_random_uuid();empty_app uuid:=gen_random_uuid();hash text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');partner_hash text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');home jsonb;row jsonb;b jsonb;
BEGIN
 INSERT INTO client_profiles(id,display_name,contact) VALUES(client,'QA portal balances','test only'),(other_client,'QA foreign balance','test only');
 INSERT INTO partners(id,public_name,status) VALUES(partner,'QA balance partner','ACTIVE');
 INSERT INTO applications(id,public_id,client_profile_id,assigned_partner_id,category,operational_status,client_payment_status,accepted_offer_snapshot) VALUES
 (app,'QA-'||app,client,partner,'general','COMPLETED','PAID_TO_PARTNER','{"client_price_thb":"1000.25","deposit_thb":"2000.00"}'),
 (unknown_app,'QA-'||unknown_app,client,partner,'general','CONFIRMED','NOT_REQUIRED_YET','{"client_price_thb":"invalid"}'),
 (empty_app,'QA-'||empty_app,client,partner,'general','CONFIRMED','NOT_REQUIRED_YET','{"client_price_thb":"10.99","deposit_thb":"0"}'),
 (other_app,'QA-'||other_app,other_client,NULL,'general','CONFIRMED','NOT_REQUIRED_YET','{"client_price_thb":"999"}');
 INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference,status) VALUES(app,client,400.10,'qa-a','VERIFIED'),(app,client,100.05,'qa-b','VERIFIED'),(app,client,500.10,'qa-pending','PENDING'),(app,client,900,'qa-rejected','REJECTED');
 PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','CLIENT','profile_id',client,'hash',hash));
 PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','PARTNER','profile_id',partner,'hash',partner_hash));
 FOREACH hash IN ARRAY ARRAY[hash,partner_hash] LOOP
 home:=pcs.portal_home(hash);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(home->'applications') a WHERE a->>'id'=other_app::text) OR EXISTS(SELECT 1 FROM jsonb_array_elements(home->'applications') a WHERE a ? 'client_contact' OR a ? 'internal_notes') THEN RAISE EXCEPTION 'QA balance scope/private data leak';END IF;
 SELECT value INTO row FROM jsonb_array_elements(home->'applications') WHERE value->>'id'=app::text;b:=row->'payment_balance';
 IF b->>'balance_status'<>'PARTIAL' OR (b->>'verified_amount')::numeric<>500.15 OR (b->>'pending_amount')::numeric<>500.10 OR (b->>'remaining')::numeric<>500.10 OR (b->>'deposit')::numeric<>2000 THEN RAISE EXCEPTION 'QA portal balance/status/credit/deposit incorrect';END IF;
 IF jsonb_typeof(b->'verified_amount')<>'string' THEN RAISE EXCEPTION 'QA numeric text lost';END IF;
 SELECT value->'payment_balance' INTO b FROM jsonb_array_elements(home->'applications') WHERE value->>'id'=unknown_app::text;
 IF b->>'balance_status'<>'UNKNOWN' OR b->>'remaining' IS NOT NULL THEN RAISE EXCEPTION 'QA unknown price reported known';END IF;
 SELECT value->'payment_balance' INTO b FROM jsonb_array_elements(home->'applications') WHERE value->>'id'=empty_app::text;
 IF b->>'balance_status'<>'UNPAID' OR (b->>'remaining')::numeric<>10.99 OR (b->>'verified_amount')::numeric<>0 THEN RAISE EXCEPTION 'QA no-claims balance missing';END IF;
 END LOOP;
 -- Aggregate every claim even when the displayed 500-row list is truncated.
 INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference,status) SELECT app,client,1,'qa-many-'||n,'VERIFIED' FROM generate_series(1,505) n;
 home:=pcs.portal_home(partner_hash);SELECT value->'payment_balance' INTO b FROM jsonb_array_elements(home->'applications') WHERE value->>'id'=app::text;
 IF jsonb_array_length(home->'payments')<>500 OR (b->>'verified_amount')::numeric<>1005.15 OR (b->>'overpayment')::numeric<>4.90 OR b->>'balance_status'<>'OVERPAID' OR (b->>'remaining')::numeric<>0 THEN RAISE EXCEPTION 'QA truncated list changes full balance';END IF;
 IF (SELECT client_payment_status FROM applications WHERE id=app)<>'PAID_TO_PARTNER' THEN RAISE EXCEPTION 'QA read changes stored payment state';END IF;
 UPDATE pcs.portal_access SET revoked_at=clock_timestamp() WHERE token_hash=partner_hash;
 BEGIN PERFORM pcs.portal_home(partner_hash);RAISE EXCEPTION 'QA revoked balance read allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END;
