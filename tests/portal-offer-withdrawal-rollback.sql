DECLARE client uuid:=gen_random_uuid();partner uuid:=gen_random_uuid();foreign_partner uuid:=gen_random_uuid();app uuid;offer uuid;other_offer uuid;private_offer uuid;foreign_offer uuid:=gen_random_uuid();version text;offer_version text;request uuid:=gen_random_uuid();payload jsonb;r jsonb;replay jsonb;n integer;ch text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');ph text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');fh text:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');
BEGIN
 INSERT INTO public.client_profiles(id,display_name,contact) VALUES(client,'QA withdrawal client','test only');
 INSERT INTO public.partners(id,public_name,status) VALUES(partner,'QA withdrawing partner','ACTIVE'),(foreign_partner,'QA other partner','ACTIVE');
 PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','CLIENT','profile_id',client,'hash',ch));PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','PARTNER','profile_id',partner,'hash',ph));PERFORM pcs.portal_admin_action('issue-access',jsonb_build_object('role','PARTNER','profile_id',foreign_partner,'hash',fh));
 r:=pcs.portal_action(ch,'request',gen_random_uuid(),'{"need":"QA withdrawal service"}');app:=(r->>'application_id')::uuid;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;PERFORM pcs.portal_admin_action('assign-partner',jsonb_build_object('application_id',app,'expected_version',version,'partner_id',partner));
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;r:=pcs.portal_action(ph,'submit-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'price','100','deposit','0','terms','QA private submitted terms'));private_offer:=(r->>'offer_id')::uuid;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=private_offer;
 INSERT INTO public.pcs_partner_offers(id,application_id,partner_id,status,client_price_thb,deposit_thb,terms) VALUES(foreign_offer,app,foreign_partner,'SUBMITTED',100,0,'QA foreign private terms');
 payload:=jsonb_build_object('application_id',app,'expected_version',version,'offer_id',private_offer,'offer_version',offer_version,'note','QA internal supplier correction','confirmed','true');
 BEGIN PERFORM pcs.portal_action(fh,'withdraw-offer',request,payload);RAISE EXCEPTION 'QA foreign partner withdrawal';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pcs.portal_action(ch,'withdraw-offer',request,payload);RAISE EXCEPTION 'QA client withdrawal';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',request,payload||'{"confirmed":"false"}');RAISE EXCEPTION 'QA unconfirmed withdrawal';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',request,payload||jsonb_build_object('offer_id',foreign_offer));RAISE EXCEPTION 'QA own app foreign offer withdrawal';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',request,payload||'{"offer_version":"stale"}');RAISE EXCEPTION 'QA stale offer withdrawal';EXCEPTION WHEN serialization_failure THEN NULL;END;
 r:=pcs.portal_action(ph,'withdraw-offer',request,payload);replay:=pcs.portal_action(ph,'withdraw-offer',request,payload);IF r<>replay OR r->>'status'<>'WITHDRAWN' THEN RAISE EXCEPTION 'QA withdrawal receipt';END IF;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',request,payload||'{"note":"QA changed withdrawal reason"}');RAISE EXCEPTION 'QA changed retry';EXCEPTION WHEN unique_violation THEN NULL;END;
 IF (SELECT count(*) FROM audit_events WHERE action='offer.withdrawn' AND entity_id=private_offer::text)<>1 OR (SELECT count(*) FROM notifications WHERE dedupe_key='offer-withdrawn:'||private_offer::text||':'||request::text)<>1 THEN RAISE EXCEPTION 'QA duplicate withdrawal audit/notification';END IF;
 IF jsonb_array_length(pcs.portal_home(ch)->'offers')<>0 OR jsonb_array_length(pcs.portal_application_history(ch,app,'offers',0)->'rows')<>0 THEN RAISE EXCEPTION 'QA private withdrawn offer leaked';END IF;
 -- Two approved alternatives: withdrawing one retains the other; withdrawing the last reopens matching.
 FOR n IN 1..2 LOOP
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;r:=pcs.portal_action(ph,'submit-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'price','100','deposit','0','terms','QA public terms '||n));offer:=(r->>'offer_id')::uuid;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=offer;
 PERFORM pcs.portal_admin_action('review-offer',jsonb_build_object('application_id',app,'expected_version',version,'offer_id',offer,'offer_version',offer_version,'decision','APPROVED'));
 IF n=1 THEN other_offer:=offer;END IF;
 END LOOP;
 UPDATE public.pcs_partner_offers SET expires_at=NULL WHERE id=offer;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=other_offer;
 PERFORM pcs.portal_action(ph,'withdraw-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'offer_id',other_offer,'offer_version',offer_version,'note','QA internal approved offer correction','confirmed','true'));
 IF (SELECT operational_status FROM public.applications WHERE id=app)<>'QUOTE_READY' THEN RAISE EXCEPTION 'QA remaining approved alternative lost';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pcs.portal_home(ch)->'offers') o WHERE o->>'id'=other_offer::text AND o->>'status'='WITHDRAWN') OR pcs.portal_home(ch)::text LIKE '%QA internal approved offer correction%' THEN RAISE EXCEPTION 'QA public withdrawal status/private reason visibility';END IF;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 BEGIN PERFORM pcs.portal_action(ch,'select-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'offer_id',other_offer));RAISE EXCEPTION 'QA withdrawn offer selectable';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=offer;
 PERFORM pcs.portal_action(ph,'withdraw-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'offer_id',offer,'offer_version',offer_version,'note','QA withdrawing final available offer','confirmed','true'));
 IF NOT EXISTS(SELECT 1 FROM public.applications WHERE id=app AND operational_status='MATCHING' AND selected_partner_offer_id IS NULL AND human_review_required AND next_action_code='REVIEW_WITHDRAWN_OFFER' AND client_payment_status='NOT_REQUIRED_YET') THEN RAISE EXCEPTION 'QA withdrawal changed selection/payment or failed matching';END IF;
 -- New reviewed replacement can be selected normally, then cannot be withdrawn.
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;r:=pcs.portal_action(ph,'submit-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'price','100','deposit','0','terms','QA replacement terms'));offer:=(r->>'offer_id')::uuid;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=offer;PERFORM pcs.portal_admin_action('review-offer',jsonb_build_object('application_id',app,'expected_version',version,'offer_id',offer,'offer_version',offer_version,'decision','APPROVED'));
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;PERFORM pcs.portal_action(ch,'select-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'offer_id',offer));
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;SELECT updated_at::text INTO offer_version FROM public.pcs_partner_offers WHERE id=offer;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',gen_random_uuid(),jsonb_build_object('application_id',app,'expected_version',version,'offer_id',offer,'offer_version',offer_version,'note','QA selected offer must remain frozen','confirmed','true'));RAISE EXCEPTION 'QA selected offer withdrawn';EXCEPTION WHEN check_violation THEN NULL;END;
 UPDATE pcs.portal_access SET revoked_at=clock_timestamp() WHERE token_hash=ph;
 BEGIN PERFORM pcs.portal_action(ph,'withdraw-offer',request,payload);RAISE EXCEPTION 'QA revoked access replays withdrawal';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END;
