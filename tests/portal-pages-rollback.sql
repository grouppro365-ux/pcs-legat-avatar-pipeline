DECLARE client uuid:=gen_random_uuid();other_client uuid:=gen_random_uuid();partner uuid:=gen_random_uuid();other_partner uuid:=gen_random_uuid();hash text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');ph text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');home jsonb;second jsonb;ids uuid[];old_app uuid;expected uuid[];bad record;
BEGIN
 INSERT INTO client_profiles(id,display_name,contact) VALUES(client,'QA cabinet pages','test only'),(other_client,'QA other pages','test only');
 INSERT INTO partners(id,public_name,status) VALUES(partner,'QA pages partner','ACTIVE'),(other_partner,'QA foreign pages partner','ACTIVE');
 INSERT INTO applications(public_id,client_profile_id,assigned_partner_id,category,operational_status,city,client_visible_notes,partner_visible_notes,updated_at)
 SELECT 'QA-PAGE-'||gen_random_uuid(),client,partner,'general',CASE WHEN n<=3 THEN 'COMPLETED' ELSE 'NEW' END,'Bangkok',CASE WHEN n=103 THEN 'Literal %_ search needle' ELSE 'Client public notes' END,'Partner private visibility notes','2100-01-01'::timestamptz FROM generate_series(1,103) n;
 INSERT INTO applications(public_id,client_profile_id,assigned_partner_id,category,operational_status,city) VALUES('QA-PAGE-FOREIGN-'||gen_random_uuid(),other_client,other_partner,'general','NEW','Bangkok');
 SELECT array_agg(id ORDER BY updated_at DESC,id) INTO expected FROM applications WHERE client_profile_id=client;old_app:=expected[103];
 INSERT INTO pcs.application_payment_claims(application_id,client_profile_id,amount_thb,reference) VALUES(old_app,client,1,'QA old page receipt');
 PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','CLIENT','profile_id',client,'hash',hash));PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','PARTNER','profile_id',partner,'hash',ph));
 FOREACH hash IN ARRAY ARRAY[hash,ph] LOOP
 home:=pcs.portal_home_page(hash,0,'all','');second:=pcs.portal_home_page(hash,1,'all','');
 IF jsonb_array_length(home->'applications')<>100 OR home->>'has_more'<>'true' OR jsonb_array_length(second->'applications')<>3 OR second->>'has_more'<>'false' OR second->>'page'<>'1' THEN RAISE EXCEPTION 'QA wrong application page boundaries';END IF;
 SELECT array_agg((value->>'id')::uuid ORDER BY ordinal) INTO ids FROM jsonb_array_elements((home->'applications')||(second->'applications')) WITH ORDINALITY e(value,ordinal);
 IF ids IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM jsonb_array_elements(home->'applications') a WHERE a ? 'client_profile_id' OR a ? 'assigned_partner_id' OR a ? 'internal_notes') THEN RAISE EXCEPTION 'QA ordering, role scope or private fields lost';END IF;
 IF jsonb_array_length(home->'payments')<>0 OR jsonb_array_length(second->'payments')<>1 OR second#>>'{payments,0,application_id}'<>old_app::text THEN RAISE EXCEPTION 'QA related payments not scoped to current page';END IF;
 IF jsonb_array_length(pcs.portal_home_page(hash,2,'all','')->'applications')<>0 THEN RAISE EXCEPTION 'QA empty page invented data';END IF;
 IF jsonb_array_length(pcs.portal_home_page(hash,0,'completed','')->'applications')<>3 OR jsonb_array_length(pcs.portal_home_page(hash,0,'active','')->'applications')<>100 OR pcs.portal_home_page(hash,0,'active','')->>'has_more'<>'false' THEN RAISE EXCEPTION 'QA terminal filter failed';END IF;
 IF jsonb_array_length(pcs.portal_home_page(hash,0,'all',' %_ ')->'applications')<>(CASE WHEN hash=ph THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'QA literal search or role-visible notes failed';END IF;
 END LOOP;
 IF pcs.portal_home(ph)->'applications' IS DISTINCT FROM pcs.portal_home_page(ph,0,'all','')->'applications' THEN RAISE EXCEPTION 'QA legacy default wrapper changed';END IF;
 FOR bad IN SELECT * FROM (VALUES(-1,'all',''),(5001,'all',''),(0,'OTHER',''),(0,'all',repeat('x',121))) t(page,view,q) LOOP
 BEGIN PERFORM pcs.portal_home_page(ph,bad.page,bad.view,bad.q);RAISE EXCEPTION 'QA bad page accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 UPDATE pcs.portal_access SET revoked_at=clock_timestamp() WHERE token_hash=ph;
 BEGIN PERFORM pcs.portal_home_page(ph,1,'all','');RAISE EXCEPTION 'QA revoked older page accessible';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END;
