DECLARE app uuid:=gen_random_uuid(); app2 uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); v text; b jsonb; r jsonb; replay jsonb; job uuid;
BEGIN
 INSERT INTO public.client_profiles(id,source_contact_id,display_name) VALUES(profile,contact,'QA follow-up');
 INSERT INTO public.applications(id,public_id,category,operational_status,client_profile_id) VALUES(app,'QA-followup-'||app,'general','NEW',profile),(app2,'QA-followup-'||app2,'general','NEW',profile);
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app;
 b:=jsonb_build_object('id',app,'request_id',request,'expected_version',v,'channel','telegram','text','Synthetic approved follow-up','scheduled_at',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'confirmed',true,'inbound_id',null,'route',jsonb_build_object('target','123','business_connection_id','qa-business'));
 BEGIN PERFORM pcs.client_followup_action('schedule',b||'{"confirmed":false}','pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA no consent accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM pcs.client_followup_action('schedule',b||jsonb_build_object('expected_version',repeat('0',32)),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA stale version accepted';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 r:=pcs.client_followup_action('schedule',b,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 IF r#>>'{job,status}'<>'PENDING' OR NOT EXISTS(SELECT 1 FROM public.pcs_workflow_outbox WHERE id=job AND event_type='CLIENT_FOLLOWUP_READY' AND payload#>>'{route,target}'='123' AND payload->>'delivery_text'='Synthetic approved follow-up') THEN RAISE EXCEPTION 'QA frozen job missing';END IF;
 replay:=pcs.client_followup_action('schedule',b,'pcs-manager-admin','["*"]');IF replay->>'replayed'<>'true' OR replay#>>'{job,id}'<>job::text THEN RAISE EXCEPTION 'QA replay failed';END IF;
 BEGIN PERFORM pcs.client_followup_action('schedule',b||'{"text":"Different"}','pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA changed retry accepted';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 BEGIN PERFORM pcs.client_followup_action('schedule',b||jsonb_build_object('request_id',gen_random_uuid()),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA duplicate active job accepted';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 -- Unknown outcome must block a fresh command until explicit reconciliation.
 UPDATE public.pcs_workflow_outbox SET status='CANCELLED',last_error='delivery_review_required' WHERE id=job;
 BEGIN PERFORM pcs.client_followup_action('schedule',b||jsonb_build_object('request_id',gen_random_uuid()),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA unknown job bypassed';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 UPDATE public.pcs_workflow_outbox SET last_error='operator_not_delivered' WHERE id=job;
 r:=pcs.client_followup_action('schedule',b||jsonb_build_object('request_id',gen_random_uuid()),'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.client_followup_action('cancel',jsonb_build_object('id',app,'request_id',gen_random_uuid(),'expected_version',v,'job_id',job),'pcs-manager-admin','["*"]');IF r#>>'{job,status}'<>'CANCELLED' THEN RAISE EXCEPTION 'QA cancellation failed';END IF;
 r:=pcs.client_followup_action('schedule',b||jsonb_build_object('request_id',gen_random_uuid()),'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 UPDATE public.pcs_workflow_outbox SET status='PROCESSING',payload=payload||jsonb_build_object('payment_worker_owner',gen_random_uuid()) WHERE id=job;
 BEGIN PERFORM pcs.client_followup_action('cancel',jsonb_build_object('id',app,'request_id',gen_random_uuid(),'expected_version',v,'job_id',job),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA active send cancelled';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 -- Staff permissions are current even when reusing an existing receipt.
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(actor,'QA follow-up','qa-followup-'||actor||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(actor,'AUDITOR_READONLY',true);
 BEGIN PERFORM pcs.client_followup_action('schedule',b,actor::text,'["*"]');RAISE EXCEPTION 'QA readonly staff scheduled';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 PERFORM pcs.staff_manage(actor,'OPS_ADMIN',true);
 SELECT md5(to_jsonb(a)::text) INTO v FROM public.applications a WHERE id=app2;b:=b||jsonb_build_object('id',app2,'request_id',gen_random_uuid(),'expected_version',v);
 r:=pcs.client_followup_action('schedule',b,actor::text,'[]');UPDATE neon_auth."user" SET banned=true WHERE id=actor;
 BEGIN PERFORM pcs.client_followup_action('schedule',b,actor::text,'["*"]');RAISE EXCEPTION 'QA banned staff read receipt';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 -- Non-Telegram schedules must freeze the enabled connection namespace too.
 job:=(r#>>'{job,id}')::uuid;
 PERFORM pcs.client_followup_action('cancel',jsonb_build_object('id',app2,'request_id',gen_random_uuid(),'expected_version',v,'job_id',job),'pcs-manager-admin','["*"]');
 b:=b||jsonb_build_object('request_id',gen_random_uuid(),'channel','instagram','route',jsonb_build_object('target','123','connection_fingerprint',repeat('a',64)));
 BEGIN PERFORM pcs.client_followup_action('schedule',b||jsonb_build_object('route',jsonb_build_object('target','123')),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA missing connection guard accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM pcs.client_followup_action('schedule',b||jsonb_build_object('route',jsonb_build_object('target','123','connection_fingerprint','invalid')),'pcs-manager-admin','["*"]');RAISE EXCEPTION 'QA malformed connection guard accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 r:=pcs.client_followup_action('schedule',b,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.pcs_workflow_outbox WHERE id=job AND payload#>>'{route,connection_fingerprint}'=repeat('a',64)) THEN RAISE EXCEPTION 'QA connection guard not frozen';END IF;
 IF has_function_privilege('public','pcs.client_followup_action(text,jsonb,text,jsonb)','EXECUTE') OR has_table_privilege('public','pcs.client_followup_commands','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'QA PUBLIC followup access';END IF;
END;
