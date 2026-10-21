CREATE TEMP TABLE audit_events (LIKE public.audit_events INCLUDING ALL) ON COMMIT DROP;
DO $qa$
DECLARE brand uuid; brand2 uuid; actor uuid:=gen_random_uuid(); p jsonb; cmd jsonb; observed jsonb; receipt jsonb; out jsonb; target uuid; v integer; denied boolean; bad jsonb;
BEGIN
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(actor,'QA content targets','qa-target-'||actor||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(actor,'OPS_ADMIN',true);
 p:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','QA target brand','guidelines','Target verification fixture only, never publish.'),'pcs-manager-admin','["*"]');brand:=(p#>>'{brand,id}')::uuid;
 p:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','QA other target brand','guidelines','Another brand cannot claim the same channel.'),'pcs-manager-admin','["*"]');brand2:=(p#>>'{brand,id}')::uuid;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'username','qa_target_channel');
 observed:='{"username":"qa_target_channel","chat_id":"-100987654321","bot_id":"123456789","title":"QA channel","can_post_messages":true}';
 p:=pcs.content_target_action(cmd,actor::text,'[]',NULL);
 IF p->>'verification_required'<>'true' OR p#>>'{snapshot,username}'<>'qa_target_channel' OR EXISTS(SELECT 1 FROM pcs.content_commands WHERE request_id=(cmd->>'request_id')::uuid) OR EXISTS(SELECT 1 FROM pcs.content_targets WHERE username='qa_target_channel') THEN RAISE EXCEPTION 'QA prepare wrote or lost snapshot';END IF;
 receipt:=pcs.content_target_action(cmd,actor::text,'[]',observed);target:=(receipt->>'id')::uuid;v:=(receipt->>'version')::integer;
 IF v<>1 OR receipt#>>'{target,enabled}'<>'true' OR receipt#>>'{target,verified_at}' IS NULL THEN RAISE EXCEPTION 'QA verified target not saved';END IF;
 out:=pcs.content_target_action(cmd,actor::text,'[]',NULL);
 IF out->>'replayed'<>'true' OR out-'replayed'<>receipt OR (SELECT count(*) FROM pg_temp.audit_events WHERE entity_id=target::text AND action='content.target')<>1 THEN RAISE EXCEPTION 'QA replay not exact once';END IF;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'username','qa_target_channel','id',target,'expected_version',v);
 p:=pcs.content_target_action(cmd,actor::text,'[]',NULL);IF p#>>'{snapshot,id}'<>target::text OR (p#>>'{snapshot,version}')::integer<>v THEN RAISE EXCEPTION 'QA update snapshot invalid';END IF;
 receipt:=pcs.content_target_action(cmd,actor::text,'[]',observed||'{"title":"QA verified again"}');v:=(receipt->>'version')::integer;
 IF v<>2 OR receipt#>>'{target,title}'<>'QA verified again' THEN RAISE EXCEPTION 'QA reverify not saved';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd||jsonb_build_object('request_id',gen_random_uuid()),actor::text,'[]',observed);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA stale update accepted';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd||jsonb_build_object('brand_id',brand2),actor::text,'[]',NULL);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA changed receipt input accepted';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd||jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand2,'expected_version',v),actor::text,'[]',observed);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA target moved between brands';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand2,'username','qa_target_channel'),actor::text,'[]',observed);EXCEPTION WHEN unique_violation THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA username reused by second brand';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand2,'username','qa_other_username'),actor::text,'[]',observed||'{"username":"qa_other_username"}');EXCEPTION WHEN unique_violation THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA same chat claimed under another username';END IF;
 -- Provider observations cannot be client assertions or loosely coerced values.
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'username','qa_target_channel','id',target,'expected_version',v);
 FOR bad IN SELECT * FROM jsonb_array_elements(jsonb_build_array(
  observed||'{"unexpected":"value"}',observed-'title',observed||'{"username":"other_channel"}',
  observed||'{"chat_id":"123"}',observed||'{"chat_id":"-0"}',observed||'{"chat_id":"-10000000000000000000"}',observed||'{"chat_id":-100987654321}',
  observed||'{"bot_id":"0"}',observed||'{"bot_id":"-123"}',observed||'{"bot_id":"10000000000000000000"}',observed||'{"bot_id":123}',
  observed||'{"can_post_messages":false}',observed||'{"can_post_messages":"true"}',observed||'{"title":""}',observed||jsonb_build_object('title',repeat('x',257))
 )) LOOP
  denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,actor::text,'[]',bad);EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA invalid observation accepted: %',bad;END IF;
 END LOOP;
 FOR bad IN SELECT * FROM jsonb_array_elements(jsonb_build_array(cmd||'{"enabled":true}',cmd||'{"username":"Upper_Channel"}',cmd||'{"expected_version":"2"}',cmd||'{"expected_version":null}',cmd||jsonb_build_object('id',gen_random_uuid(),'expected_version',v))) LOOP
  denied:=false;BEGIN PERFORM pcs.content_target_action(bad,actor::text,'[]',NULL);EXCEPTION WHEN invalid_parameter_value OR serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA invalid target command accepted';END IF;
 END LOOP;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,'pcs-manager-admin',NULL,observed);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA null permissions accepted';END IF;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,gen_random_uuid()::text,'["*"]',observed);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA forged staff permissions accepted';END IF;
 -- A failed audit must leave no change or receipt; retry can then save once.
 ALTER TABLE pg_temp.audit_events ADD CONSTRAINT qa_target_audit_failure CHECK(action<>'content.target') NOT VALID;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,actor::text,'[]',observed);EXCEPTION WHEN check_violation THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA target audit failure ignored';END IF;
 IF EXISTS(SELECT 1 FROM pcs.content_targets WHERE id=target AND version<>v) OR EXISTS(SELECT 1 FROM pcs.content_commands WHERE request_id=(cmd->>'request_id')::uuid) THEN RAISE EXCEPTION 'QA audit failure leaked mutation';END IF;
 ALTER TABLE pg_temp.audit_events DROP CONSTRAINT qa_target_audit_failure;
 receipt:=pcs.content_target_action(cmd,actor::text,'[]',observed);IF (receipt->>'version')::integer<>v+1 THEN RAISE EXCEPTION 'QA retry after audit failure did not save';END IF;
 PERFORM pcs.staff_manage(actor,'AUDITOR_READONLY',true);
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,actor::text,'["*"]',NULL);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA revoked actor replay accepted';END IF;
 PERFORM pcs.staff_manage(actor,'OPS_ADMIN',true);UPDATE neon_auth."user" SET banned=true WHERE id=actor;
 denied:=false;BEGIN PERFORM pcs.content_target_action(cmd,actor::text,'["*"]',NULL);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA banned actor replay accepted';END IF;
 UPDATE neon_auth."user" SET banned=false WHERE id=actor;
 out:=pcs.content_target_action(cmd,actor::text,'[]',NULL);IF out->>'replayed'<>'true' OR out-'replayed'<>receipt THEN RAISE EXCEPTION 'QA valid replay after restore failed';END IF;
 IF has_function_privilege('public','pcs.content_target_action(jsonb,text,jsonb,jsonb)','EXECUTE') OR has_table_privilege('public','pcs.content_targets','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'QA target PUBLIC privileges exposed';END IF;
END $qa$;
