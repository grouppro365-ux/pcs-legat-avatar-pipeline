DECLARE app uuid:=gen_random_uuid(); app2 uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); cmd uuid:=gen_random_uuid(); v text; r jsonb; q jsonb; n int;
BEGIN
 INSERT INTO public.applications(id,public_id,category,operational_status,qualification_data) VALUES(app,'QA-qualification-'||app,'general','NEW','{"booking_marker":"preserve"}');
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app;
 BEGIN PERFORM pcs.save_request_qualification(app,v,cmd,'car_rental','{"total_amount":"123"}','Synthetic chat',null);RAISE EXCEPTION 'QA accepted forbidden field';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM pcs.save_request_qualification(app,v,cmd,'car_rental','{"start_date":"2026-02-30"}','Synthetic chat',null);RAISE EXCEPTION 'QA accepted bad calendar date';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM pcs.save_request_qualification(app,v,cmd,'service','{}','Synthetic chat',actor);RAISE EXCEPTION 'QA accepted unknown staff';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 BEGIN PERFORM pcs.save_request_qualification(app,repeat('0',32),cmd,'service','{}','Synthetic chat',null);RAISE EXCEPTION 'QA accepted stale version';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 r:=pcs.save_request_qualification(app,v,cmd,'property_buy','{"city":"Pattaya","purchase_goal":"Home"}','Synthetic client chat',null);
 q:=pcs.save_request_qualification(app,v,cmd,'property_buy','{"city":"Pattaya","purchase_goal":"Home"}','Synthetic client chat',null);
 IF r IS DISTINCT FROM q THEN RAISE EXCEPTION 'QA retry did not return receipt';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.applications WHERE id=app AND qualification_data->>'booking_marker'='preserve' AND qualification_data#>>'{operator_qualification,answers,purchase_goal}'='Home' AND operational_status='NEW' AND selected_partner_offer_id IS NULL AND item_id IS NULL) THEN RAISE EXCEPTION 'QA answers missing or canonical fields mutated';END IF;
 SELECT count(*) INTO n FROM public.audit_events WHERE entity_id=app::text AND action='request_qualification_updated';IF n<>1 THEN RAISE EXCEPTION 'QA audit not exactly once';END IF;
 BEGIN PERFORM pcs.save_request_qualification(app,v,cmd,'property_buy','{}','Synthetic client chat',null);RAISE EXCEPTION 'QA retry changed accepted';EXCEPTION WHEN SQLSTATE '23505' THEN NULL;END;

 -- Each service writes through the existing atomic command, without booking mutations.
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app;
 BEGIN PERFORM pcs.save_request_qualification(app,v,gen_random_uuid(),'visa','{"pickup":"BKK"}','Synthetic visa chat',null);RAISE EXCEPTION 'QA visa accepted transfer field';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 r:=pcs.save_request_qualification(app,v,gen_random_uuid(),'visa','{"nationality":"Synthetic nationality","current_status":"Visa exemption","current_location":"Pattaya","target_visa":"Study","timeline":"November"}','Synthetic visa chat',null);
 IF NOT EXISTS(SELECT 1 FROM public.applications WHERE id=app AND qualification_data#>>'{operator_qualification,type}'='visa' AND qualification_data#>>'{operator_qualification,answers,target_visa}'='Study' AND qualification_data->>'booking_marker'='preserve') THEN RAISE EXCEPTION 'QA visa not saved';END IF;
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app;
 BEGIN PERFORM pcs.save_request_qualification(app,v,gen_random_uuid(),'transfer','{"transfer_date":"2026-02-30"}','Synthetic transfer chat',null);RAISE EXCEPTION 'QA transfer accepted bad calendar date';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM pcs.save_request_qualification(app,v,gen_random_uuid(),'transfer','{"transfer_time":"24:00"}','Synthetic transfer chat',null);RAISE EXCEPTION 'QA transfer accepted invalid time';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 r:=pcs.save_request_qualification(app,v,gen_random_uuid(),'transfer','{"pickup":"BKK","dropoff":"Pattaya","transfer_date":"2026-11-01","transfer_time":"23:45","passengers":"3","luggage":"2 bags"}','Synthetic transfer chat',null);
 IF NOT EXISTS(SELECT 1 FROM public.applications WHERE id=app AND qualification_data#>>'{operator_qualification,type}'='transfer' AND qualification_data#>>'{operator_qualification,answers,transfer_time}'='23:45' AND operational_status='NEW' AND selected_partner_offer_id IS NULL AND item_id IS NULL) THEN RAISE EXCEPTION 'QA transfer missing or canonical fields mutated';END IF;
 UPDATE public.applications SET operational_status='CONFIRMED' WHERE id=app;
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app;
 BEGIN PERFORM pcs.save_request_qualification(app,v,gen_random_uuid(),'service','{}','Synthetic chat',null);RAISE EXCEPTION 'QA confirmed application edited';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(actor,'QA qualification','qa-qualification-'||actor||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(actor,'AUDITOR_READONLY',true);
 INSERT INTO public.applications(id,public_id,category,operational_status) VALUES(app2,'QA-qualification-staff-'||app2,'general','NEW');
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app2;
 BEGIN PERFORM pcs.save_request_qualification(app2,v,gen_random_uuid(),'service','{}','Synthetic chat',actor);RAISE EXCEPTION 'QA readonly staff wrote';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 PERFORM pcs.staff_manage(actor,'OPS_ADMIN',true);
 cmd:=gen_random_uuid();r:=pcs.save_request_qualification(app2,v,cmd,'service','{}','Synthetic chat',actor);
 IF NOT EXISTS(SELECT 1 FROM public.audit_events WHERE entity_id=app2::text AND actor_role='STAFF' AND patch->>'auth_user_id'=actor::text) THEN RAISE EXCEPTION 'QA actor audit missing';END IF;
 UPDATE neon_auth."user" SET banned=true WHERE id=actor;
 BEGIN PERFORM pcs.save_request_qualification(app2,v,cmd,'service','{}','Synthetic chat',actor);RAISE EXCEPTION 'QA banned staff read receipt';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
END;
