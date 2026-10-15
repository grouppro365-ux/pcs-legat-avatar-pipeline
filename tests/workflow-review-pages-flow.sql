 DECLARE auth uuid:=gen_random_uuid();review_app uuid:=gen_random_uuid();old_offer uuid:=gen_random_uuid();r record;claim_row record;offer_row record;version text;found_old boolean:=false;n integer:=0;
 BEGIN
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(auth,'QA older review staff','qa-review-pages-'||auth||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(auth,'AUDITOR_READONLY',true);
 UPDATE pcs.application_payment_claims SET created_at='2000-01-01' WHERE application_id=app AND reference='qa-pending';
 FOR r IN EXECUTE $payments$__WORKFLOW_PAYMENTS__$payments$ USING app,500 LOOP
 n:=n+1;IF r.status='PENDING' THEN claim_row:=r;found_old:=true;END IF;
 END LOOP;
 IF n<>9 OR NOT found_old THEN RAISE EXCEPTION 'QA older pending payment unreachable';END IF;
 SELECT updated_at::text INTO version FROM public.applications WHERE id=app;
 BEGIN PERFORM pcs.staff_workflow_action(auth,'review-payment',jsonb_build_object('application_id',app,'expected_version',version,'claim_id',claim_row.id,'claim_version',claim_row.edit_version,'decision','REJECTED','note','QA review older bank reference'));RAISE EXCEPTION 'QA readonly reviews older payment';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM pcs.staff_manage(auth,'FINANCE_RECONCILIATION',true);
 PERFORM pcs.staff_workflow_action(auth,'review-payment',jsonb_build_object('application_id',app,'expected_version',version,'claim_id',claim_row.id,'claim_version',claim_row.edit_version,'decision','REJECTED','note','QA review older bank reference'));
 IF (SELECT status FROM pcs.application_payment_claims WHERE id=claim_row.id)<>'REJECTED' THEN RAISE EXCEPTION 'QA older payment review not persisted';END IF;
 INSERT INTO public.applications(id,public_id,client_profile_id,assigned_partner_id,category,operational_status) VALUES(review_app,'QA-'||review_app,client,partner,'general','MATCHING');
 INSERT INTO public.pcs_partner_offers(id,application_id,partner_id,status,client_price_thb,deposit_thb,terms,expires_at,created_at) VALUES(old_offer,review_app,partner,'SUBMITTED',100,0,'QA older submitted terms',now()+interval '1 day','2000-01-01');
 INSERT INTO public.pcs_partner_offers(application_id,partner_id,status,client_price_thb,deposit_thb,terms,expires_at) SELECT review_app,partner,'REJECTED',100,0,'QA later rejected terms',now()+interval '1 day' FROM generate_series(1,101);
 found_old:=false;
 FOR r IN EXECUTE $offers$__WORKFLOW_OFFERS__$offers$ USING review_app,100 LOOP
 IF r.id=old_offer THEN offer_row:=r;found_old:=true;END IF;
 END LOOP;
 IF NOT found_old THEN RAISE EXCEPTION 'QA older offer unreachable';END IF;
 PERFORM pcs.staff_manage(auth,'CONCIERGE_MANAGER',true);SELECT updated_at::text INTO version FROM public.applications WHERE id=review_app;
 BEGIN PERFORM pcs.staff_workflow_action(auth,'review-offer',jsonb_build_object('application_id',review_app,'expected_version',version,'offer_id',offer_row.id,'offer_version','stale','decision','APPROVED'));RAISE EXCEPTION 'QA older offer stale write accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM pcs.staff_workflow_action(auth,'review-offer',jsonb_build_object('application_id',review_app,'expected_version',version,'offer_id',offer_row.id,'offer_version',offer_row.edit_version,'decision','APPROVED'));
 IF (SELECT status FROM public.pcs_partner_offers WHERE id=old_offer)<>'APPROVED' OR (SELECT operational_status FROM public.applications WHERE id=review_app)<>'QUOTE_READY' THEN RAISE EXCEPTION 'QA older offer approval not persisted';END IF;
 END;
