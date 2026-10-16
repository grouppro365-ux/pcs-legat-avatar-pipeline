DECLARE source_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); message_id uuid:=gen_random_uuid(); first jsonb; repeated jsonb; second jsonb; another jsonb; telegram jsonb; profile uuid;
BEGIN
 first:=pcs.runtime_intake(source_id,request_id,'whatsapp',message_id,NULL,NULL,'Shared name','Rental request','QA isolated');
 profile:=(first->>'client_profile_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM client_profiles WHERE id=profile AND source_contact_id=source_id AND telegram_id IS NULL) THEN RAISE EXCEPTION 'QA missing canonical source binding'; END IF;
 repeated:=pcs.runtime_intake(source_id,request_id,'whatsapp',gen_random_uuid(),NULL,NULL,'Changed display','Rental request','QA isolated');
 IF repeated<>first THEN RAISE EXCEPTION 'QA intake not idempotent after newer inbound'; END IF;
 IF (SELECT count(*) FROM audit_events WHERE entity_id=request_id::text AND action='runtime.request.created')<>1 THEN RAISE EXCEPTION 'QA duplicate audit'; END IF;
 BEGIN PERFORM pcs.runtime_intake(source_id,request_id,'whatsapp',message_id,NULL,NULL,'Shared name','Changed intent','QA isolated'); RAISE EXCEPTION 'QA changed replay accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM pcs.runtime_intake(source_id,request_id,'facebook',message_id,NULL,NULL,'Shared name','Rental request','QA isolated'); RAISE EXCEPTION 'QA changed channel replay accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 second:=pcs.runtime_intake(source_id,gen_random_uuid(),'whatsapp',message_id,NULL,NULL,'Shared name','Another request','QA isolated');
 IF second->>'client_profile_id'<>first->>'client_profile_id' THEN RAISE EXCEPTION 'QA duplicate source profile'; END IF;
 another:=pcs.runtime_intake(gen_random_uuid(),gen_random_uuid(),'instagram',message_id,NULL,NULL,'Shared name','Another person','QA isolated');
 IF another->>'client_profile_id'=first->>'client_profile_id' THEN RAISE EXCEPTION 'QA fuzzy name merge'; END IF;
 UPDATE client_profiles SET blocked=true WHERE id=profile;
 BEGIN PERFORM pcs.runtime_intake(source_id,gen_random_uuid(),'whatsapp',message_id,NULL,NULL,'Shared name','Blocked request','QA isolated'); RAISE EXCEPTION 'QA blocked intake accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM pcs.runtime_intake(source_id,request_id,'whatsapp',message_id,NULL,NULL,'Shared name','Rental request','QA isolated'); RAISE EXCEPTION 'QA blocked replay accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE client_profiles SET blocked=false,merged_into_id=(another->>'client_profile_id')::uuid WHERE id=profile;
 BEGIN PERFORM pcs.runtime_intake(source_id,gen_random_uuid(),'whatsapp',message_id,NULL,NULL,'Shared name','Merged request','QA isolated'); RAISE EXCEPTION 'QA merged intake accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM pcs.runtime_intake(gen_random_uuid(),gen_random_uuid(),'whatsapp',NULL,NULL,NULL,'Shared name','No proof','QA isolated'); RAISE EXCEPTION 'QA no proof accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM pcs.runtime_intake(gen_random_uuid(),gen_random_uuid(),NULL,message_id,NULL,NULL,'Shared name','No channel','QA isolated'); RAISE EXCEPTION 'QA null channel accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 telegram:=pcs.runtime_intake(gen_random_uuid(),gen_random_uuid(),'telegram',NULL,'999'||floor(random()*1000000000000)::bigint::text,NULL,'QA Telegram','TG request','QA isolated');
 IF NOT EXISTS(SELECT 1 FROM client_profiles WHERE id=(telegram->>'client_profile_id')::uuid AND telegram_id IS NOT NULL) THEN RAISE EXCEPTION 'QA Telegram identity regression'; END IF;
END
