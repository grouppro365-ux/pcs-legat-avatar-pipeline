DO $qa$
DECLARE b uuid; pid uuid; job uuid; owner text:='github:39984787683:1'; sha text:=repeat('a',40); r jsonb; cmd jsonb; p jsonb; spec jsonb; receipt jsonb; artifact jsonb; cid uuid; version integer; denied boolean; uid uuid:=gen_random_uuid(); i integer; count_before integer; ids uuid[]; captions jsonb; caption_spec jsonb; bad jsonb; caption_text text;
BEGIN
 spec:='{"version":1,"mode":"TEXT_TO_VIDEO","preset":"landscape","fit":"contain","shots":[{"prompt":"A green leaf moves gently in natural daylight.","negative_prompt":"text, watermark","seed":42,"frames":17}]}';
 IF pcs.content_video_spec_valid(spec-'preset','telegram') IS DISTINCT FROM false OR pcs.content_video_spec_valid(jsonb_set(spec,'{shots,0}',(spec#>'{shots,0}')-'frames'),'telegram') IS DISTINCT FROM false THEN RAISE EXCEPTION 'QA missing fields bypass SQL NULL guards';END IF;
 captions:='{"version":1,"style":"readable-v1","language":"ru","cues":[{"start_frame":0,"end_frame":24,"text":"Проверенный текст оператора"},{"start_frame":24,"end_frame":51,"text":"Точные условия\nБез новых обещаний"}]}';
 caption_spec:=spec||jsonb_build_object('version',2,'finishing',captions);
 IF pcs.content_video_spec_valid(caption_spec,'telegram') IS DISTINCT FROM true OR pcs.content_video_spec_valid(spec||jsonb_build_object('finishing',captions),'telegram') IS DISTINCT FROM false OR pcs.content_video_spec_valid(caption_spec-'finishing','telegram') IS DISTINCT FROM false THEN RAISE EXCEPTION 'QA caption spec version contract';END IF;
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(captions-'style',captions-'language',captions-'cues',captions||'{"language":"th"}',captions||'{"font_path":"/private/file"}',captions||'{"cues":[]}',captions||'{"cues":[{"start_frame":0,"end_frame":52,"text":"Text"}]}',captions||'{"cues":[{"start_frame":0,"end_frame":25,"text":"Text"},{"start_frame":24,"end_frame":51,"text":"Text"}]}',captions||'{"cues":[{"end_frame":51,"text":"Text"}]}')) LOOP
  IF pcs.content_video_finishing_valid(bad,51) IS DISTINCT FROM false THEN RAISE EXCEPTION 'QA invalid caption contract accepted';END IF;
 END LOOP;
 FOREACH caption_text IN ARRAY ARRAY['',' ',chr(160)||chr(8192),'A'||chr(10),'A'||chr(10)||'B'||chr(10)||'C',repeat('A',37),repeat('A',36)||chr(10)||repeat('Б',36),'{'||chr(92)||'pos(0,0)}Text','Text'||chr(92)||'Nnew','A'||chr(9)||'B','A'||chr(13)||'B','A'||chr(133)||'B','A'||chr(173)||'B','A'||chr(1564)||'B','A'||chr(8203)||'B','A'||chr(8232)||'B','A'||chr(8238)||'B','A'||chr(8288)||'B','A'||chr(65279)||'B'] LOOP
  bad:=jsonb_set(captions,'{cues}',jsonb_build_array(jsonb_build_object('start_frame',0,'end_frame',51,'text',caption_text)));
  IF pcs.content_video_finishing_valid(bad,51) IS DISTINCT FROM false THEN RAISE EXCEPTION 'QA caption text injection or bounds accepted';END IF;
 END LOOP;
 FOREACH caption_text IN ARRAY ARRAY[repeat('A',36),repeat('A',36)||chr(10)||repeat('Б',35),repeat(chr(128512),36)] LOOP
  bad:=jsonb_set(captions,'{cues}',jsonb_build_array(jsonb_build_object('start_frame',0,'end_frame',51,'text',caption_text)));
  IF pcs.content_video_finishing_valid(bad,51) IS DISTINCT FROM true THEN RAISE EXCEPTION 'QA Unicode caption codepoint count';END IF;
 END LOOP;
 r:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','QA video rollback','guidelines','Only verified public facts and manual review.'),'pcs-manager-admin','["*"]');b:=(r#>>'{brand,id}')::uuid;
 r:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',b,'platform','telegram','language','en','title','QA video','body','Technical fixture only, not a customer publication.','source_facts','Synthetic rollback fixture, no customer assets.','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');pid:=(r->>'id')::uuid;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'post_id',pid,'expected_post_version',(r->>'version')::integer,'revision',1,'spec',spec,'confirmed',true,'upscale_confirmed',true);
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd,'pcs-manager-admin','[]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA no permission bypass';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd||jsonb_build_object('expected_post_version',1),'pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA stale post version accepted';END IF;
 r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["content.edit"]');job:=(r#>>'{job,id}')::uuid;
 IF r#>>'{job,stage}'<>'QUEUED' OR r#>>'{job,status}'<>'PENDING' THEN RAISE EXCEPTION 'QA initial queue state';END IF;
 r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["content.edit"]');IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA create receipt not replayed';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd||'{"spec":{}}','pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA conflicting request receipt';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',jsonb_set(cmd,'{request_id}',to_jsonb(gen_random_uuid())),'pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA duplicate live job';END IF;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);cid:=(r#>>'{job,claim_id}')::uuid;version:=(r#>>'{job,version}')::integer;
 IF r#>>'{job,id}'<>job::text OR r#>>'{job,stage}'<>'PREPARING' THEN RAISE EXCEPTION 'QA exact queue claim';END IF;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);IF r#>>'{job,claim_id}'<>cid::text OR (r#>>'{job,version}')::integer<>version THEN RAISE EXCEPTION 'QA reentry created new claim';END IF;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);
 denied:=false;BEGIN PERFORM pcs.content_video_worker('read',p,'github:39984787683:2',sha);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA other attempt ownership bypass';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_worker('progress',p,owner,sha);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA missing worker stage accepted';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_worker('progress',p||jsonb_build_object('stage','GENERATING','expected_version',version+1),owner,sha);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA stale worker version accepted';END IF;
 r:=pcs.content_video_worker('progress',p||'{"stage":"GENERATING"}',owner,sha);version:=(r#>>'{job,version}')::integer;
 p:=p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version);
 denied:=false;BEGIN PERFORM pcs.content_video_worker('progress',p||'{"stage":"POST_PROCESSING"}',owner,sha);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA postprocessing before accepted GPU receipt';END IF;
 receipt:=jsonb_build_object('kernel','tatyanathai/pcs-legat-ai-avatar-pipeline','version',97,'ref','tatyanathai/pcs-legat-ai-avatar-pipeline/97','run_id',cid);
 r:=pcs.content_video_worker('progress',p||jsonb_build_object('stage','GENERATING','provider_receipt',receipt),owner,sha);version:=(r#>>'{job,version}')::integer;
 p:=p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version);r:=pcs.content_video_worker('progress',p||jsonb_build_object('stage','POST_PROCESSING','provider_receipt',receipt),owner,sha);version:=(r#>>'{job,version}')::integer;
 p:=p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version);r:=pcs.content_video_worker('progress',p||'{"stage":"QA"}',owner,sha);version:=(r#>>'{job,version}')::integer;
 artifact:=jsonb_build_object('bucket','pcs-content-video','path','jobs/'||job::text||'/'||cid::text||'/final.mp4','sha256',repeat('a',64),'bytes',4096,'width',1280,'height',720,'fps',24,'frames',51,'duration_seconds',2.125,'decode_verified',true,'codec','h264','technical_qa','PASSED','manual_review_required',true,'cover',jsonb_build_object('bucket','pcs-content-video','path','jobs/'||job::text||'/'||cid::text||'/cover.png','sha256',repeat('b',64),'bytes',100),'source_model','Lightricks/LTX-Video-0.9.5','model_revision','e58e28c39631af4d1468ee57a853764e11c1d37e','manifest_sha256',repeat('c',64));
 p:=p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version);
 denied:=false;BEGIN PERFORM pcs.content_video_worker('complete',p||jsonb_build_object('artifact',jsonb_set(artifact,'{cover,path}','"another-object"')),owner,sha);EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA foreign cover accepted';END IF;
 r:=pcs.content_video_worker('complete',p||jsonb_build_object('artifact',artifact),owner,sha);version:=(r#>>'{job,version}')::integer;
 IF r#>>'{job,stage}'<>'READY' OR r#>>'{job,status}'<>'SENT' OR r#>>'{job,review_status}'<>'PENDING' OR (SELECT status FROM pcs.content_posts WHERE id=pid)<>'DRAFT' THEN RAISE EXCEPTION 'QA completion published or approved content';END IF;
 r:=pcs.content_video_worker('complete',p||jsonb_build_object('artifact',artifact),owner,sha);IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA completion replay failed';END IF;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version,'decision','APPROVED','artifact_sha256',repeat('b',64),'confirmed',true,'note','Reviewer checked this synthetic rollback artifact.');
 denied:=false;BEGIN PERFORM pcs.content_video_action('review',p,'pcs-manager-admin','["content.approve"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA wrong artifact reviewed';END IF;
 r:=pcs.content_video_action('review',p||jsonb_build_object('artifact_sha256',repeat('a',64)),'pcs-manager-admin','["content.approve"]');IF r#>>'{job,review_status}'<>'APPROVED' THEN RAISE EXCEPTION 'QA review missing';END IF;
 -- Unknown GPU launch and running cancellation must block a fresh request ID.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid());r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);cid:=(r#>>'{job,claim_id}')::uuid;version:=(r#>>'{job,version}')::integer;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);r:=pcs.content_video_worker('progress',p||'{"stage":"GENERATING"}',owner,sha);version:=(r#>>'{job,version}')::integer;
 r:=pcs.content_video_action('cancel',jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version),'pcs-manager-admin','["*"]');version:=(r#>>'{job,version}')::integer;
 IF r#>>'{job,error_code}'<>'GPU_LAUNCH_UNKNOWN' OR r#>>'{job,stage}'<>'CANCELLED' THEN RAISE EXCEPTION 'QA cancelled compute uncertainty lost';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',jsonb_set(cmd,'{request_id}',to_jsonb(gen_random_uuid())),'pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA unknown launch did not block fresh job';END IF;
 PERFORM pcs.content_video_action('resolve-unknown',jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version,'provider_checked',true,'note','Operator verified that the synthetic provider job is no longer executing.'),'pcs-manager-admin','["content.approve"]');
 -- An accepted provider receipt does not prove polling failures stopped compute.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid());r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);cid:=(r#>>'{job,claim_id}')::uuid;version:=(r#>>'{job,version}')::integer;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);r:=pcs.content_video_worker('progress',p||'{"stage":"GENERATING"}',owner,sha);version:=(r#>>'{job,version}')::integer;
 receipt:=jsonb_set(receipt,'{run_id}',to_jsonb(cid));p:=p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version);r:=pcs.content_video_worker('progress',p||jsonb_build_object('stage','GENERATING','provider_receipt',receipt),owner,sha);version:=(r#>>'{job,version}')::integer;
 r:=pcs.content_video_worker('fail',p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version,'error_code','VIDEO_GENERATION_FAILED'),owner,sha);version:=(r#>>'{job,version}')::integer;
 IF r#>>'{job,error_code}'<>'GPU_LAUNCH_UNKNOWN' OR r#>>'{job,failure_cause}'<>'VIDEO_GENERATION_FAILED' OR r#>'{job,provider_receipt}'<>receipt THEN RAISE EXCEPTION 'QA accepted compute failure lost uncertainty or receipt';END IF;
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',jsonb_set(cmd,'{request_id}',to_jsonb(gen_random_uuid())),'pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA accepted compute failure allowed fresh job';END IF;
 PERFORM pcs.content_video_action('resolve-unknown',jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version,'provider_checked',true,'note','Operator verified that the accepted synthetic provider job is no longer executing.'),'pcs-manager-admin','["content.approve"]');
 -- Managed creators are rechecked even when callers supply forged permissions.
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(uid,'QA video','qa-video-'||uid||'@example.invalid',false,now(),now(),false);PERFORM pcs.staff_manage(uid,'OPS_ADMIN',true);
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid());r:=pcs.content_video_action('create',cmd,uid::text,'[]');job:=(r#>>'{job,id}')::uuid;
 PERFORM pcs.staff_manage(uid,'AUDITOR_READONLY',true);
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd,uid::text,'["*"]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA revoked creator replay';END IF;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);IF r->'job'<>'null'::jsonb OR (SELECT status FROM public.pcs_workflow_outbox WHERE id=job)<>'CANCELLED' THEN RAISE EXCEPTION 'QA revoked creator claimed';END IF;
 -- Expired compute is failed with an explicit uncertainty gate, never requeued.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid());r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);cid:=(r#>>'{job,claim_id}')::uuid;version:=(r#>>'{job,version}')::integer;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);r:=pcs.content_video_worker('progress',p||'{"stage":"GENERATING"}',owner,sha);
 UPDATE public.pcs_workflow_outbox SET payload=payload||jsonb_build_object('updated_at',clock_timestamp()-interval '186 minutes') WHERE id=job;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),'github:39984787684:1',sha);
 IF r->'job'<>'null'::jsonb OR (SELECT last_error FROM public.pcs_workflow_outbox WHERE id=job)<>'GPU_LAUNCH_UNKNOWN' THEN RAISE EXCEPTION 'QA expired compute requeued';END IF;
 -- A revision change cancels a queued snapshot before any GPU is launched.
 r:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',b,'platform','telegram','language','en','title','QA stale source','body','Technical fixture with a changed source revision.','source_facts','Synthetic rollback fixture, no customer assets.','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');pid:=(r->>'id')::uuid;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'post_id',pid,'expected_post_version',(r->>'version')::integer,'revision',1,'spec',spec,'confirmed',true,'upscale_confirmed',true);
 r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',2,'platform','telegram','language','en','title','New source revision','body','Changed public draft must invalidate the old GPU snapshot.','source_facts','Synthetic updated rollback facts only.','source_url','https://example.com/qa');
 r:=pcs.content_action('revise',p,'pcs-manager-admin','["*"]');
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);IF r->'job'<>'null'::jsonb OR (SELECT status FROM public.pcs_workflow_outbox WHERE id=job)<>'CANCELLED' THEN RAISE EXCEPTION 'QA changed source was claimed';END IF;
 -- A changed brand during launch is cancelled but retains the uncertainty gate.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid(),'expected_post_version',3,'revision',2);r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);cid:=(r#>>'{job,claim_id}')::uuid;version:=(r#>>'{job,version}')::integer;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);r:=pcs.content_video_worker('progress',p||'{"stage":"GENERATING"}',owner,sha);version:=(r#>>'{job,version}')::integer;
 UPDATE pcs.content_brands cb SET version=cb.version+1 WHERE cb.id=b;
 r:=pcs.content_video_worker('read',p||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',version),owner,sha);IF r->>'stopped'<>'true' OR r#>>'{job,error_code}'<>'GPU_LAUNCH_UNKNOWN' THEN RAISE EXCEPTION 'QA stale launch lost uncertainty';END IF;version:=(r#>>'{job,version}')::integer;
 IF NOT EXISTS(SELECT 1 FROM audit_events WHERE action='content.video.worker.cancelled' AND patch->>'job_id'=job::text) THEN RAISE EXCEPTION 'QA cancelled read missing audit';END IF;
 -- Once the draft follows the new rules, old unknown compute still blocks it.
 r:=pcs.content_action('revise',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',3,'platform','telegram','language','en','title','Current brand revision','body','Public draft now uses the current brand rules.','source_facts','Synthetic current-brand rollback facts.','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid(),'expected_post_version',4,'revision',3);
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA new source bypassed unknown compute';END IF;
 PERFORM pcs.content_video_action('resolve-unknown',jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version,'provider_checked',true,'note','Operator verified the obsolete synthetic provider job is no longer executing.'),'pcs-manager-admin','["*"]');
 -- A failing audit must roll back the queued job and its command receipt.
 count_before:=(SELECT count(*) FROM public.pcs_workflow_outbox WHERE event_type='CONTENT_VIDEO_GENERATION');
 EXECUTE 'CREATE OR REPLACE FUNCTION pcs.qa_video_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action=''content.video.create'' THEN RAISE EXCEPTION ''qa video audit rejected'' USING ERRCODE=''Z0002'';END IF;RETURN NEW;END $f$';
 EXECUTE 'CREATE TRIGGER qa_video_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pcs.qa_video_audit_failure()';
 denied:=false;BEGIN PERFORM pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');EXCEPTION WHEN SQLSTATE 'Z0002' THEN denied:=true;END;
 IF NOT denied OR (SELECT count(*) FROM public.pcs_workflow_outbox WHERE event_type='CONTENT_VIDEO_GENERATION')<>count_before OR EXISTS(SELECT 1 FROM pcs.content_commands WHERE request_id=(cmd->>'request_id')::uuid) THEN RAISE EXCEPTION 'QA audit did not roll back video command';END IF;
 EXECUTE 'DROP TRIGGER qa_video_audit_failure ON public.audit_events';
 -- Caption finishing stays in the canonical job, with unchanged claim/cancel semantics.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid(),'spec',caption_spec);
 r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 IF r#>'{job,spec}' IS DISTINCT FROM caption_spec THEN RAISE EXCEPTION 'QA caption text changed during enqueue';END IF;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);version:=(r#>>'{job,version}')::integer;
 IF r#>>'{job,id}'<>job::text OR r#>'{job,spec,finishing}' IS DISTINCT FROM captions THEN RAISE EXCEPTION 'QA caption finishing lost on claim';END IF;
 PERFORM pcs.content_video_action('cancel',jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'expected_version',version),'pcs-manager-admin','["*"]');
 -- A preflight caption failure cannot persist raw operator text or consume GPU.
 cmd:=cmd||jsonb_build_object('request_id',gen_random_uuid());r:=pcs.content_video_action('create',cmd,'pcs-manager-admin','["*"]');job:=(r#>>'{job,id}')::uuid;
 r:=pcs.content_video_worker('claim',jsonb_build_object('request_id',gen_random_uuid()),owner,sha);version:=(r#>>'{job,version}')::integer;cid:=(r#>>'{job,claim_id}')::uuid;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'job_id',job,'claim_id',cid,'expected_version',version);
 denied:=false;BEGIN PERFORM pcs.content_video_worker('fail',p||'{"error_code":"CAPTION_GLYPH_UNSUPPORTED: raw private caption"}',owner,sha);EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA raw caption error accepted';END IF;
 r:=pcs.content_video_worker('fail',p||'{"error_code":"CAPTION_GLYPH_UNSUPPORTED"}',owner,sha);
 IF r#>>'{job,error_code}'<>'CAPTION_GLYPH_UNSUPPORTED' OR r#>>'{job,failure_cause}'<>'CAPTION_GLYPH_UNSUPPORTED' OR r#>>'{job,stage}'<>'FAILED' OR r#>'{job,provider_receipt}' IS NOT NULL THEN RAISE EXCEPTION 'QA caption preflight failure contract';END IF;
 IF has_function_privilege('public','pcs.content_video_action(text,jsonb,text,jsonb)','EXECUTE') OR has_function_privilege('public','pcs.content_video_worker(text,jsonb,text,text)','EXECUTE') OR has_function_privilege('public','pcs.content_video_finishing_valid(jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'QA public video execution';END IF;
END $qa$;
