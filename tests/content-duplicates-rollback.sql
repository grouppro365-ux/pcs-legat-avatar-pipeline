DO $qa$
DECLARE brand uuid; pid uuid; other uuid; v integer; cmd jsonb; snap jsonb; r jsonb; denied boolean; result jsonb; auth_id uuid:=gen_random_uuid(); i integer;
BEGIN
 r:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','QA semantic','guidelines','Only verified facts, no guarantees.'),'pcs-manager-admin','["*"]'); brand:=(r#>>'{brand,id}')::uuid;
 r:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','telegram','language','th','title','Original','body','Original semantic fixture text','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');pid:=(r->>'id')::uuid;v:=(r->>'version')::integer;
 r:=pcs.content_action('submit',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 denied:=false;BEGIN PERFORM pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true),'pcs-manager-admin','["*"]');EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA approval bypass';END IF;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);
 r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');snap:=r->'snapshot';IF snap->>'corpus_count'<>'0' THEN RAISE EXCEPTION 'QA empty corpus incorrect';END IF;
 r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');IF r->>'pending'<>'true' OR r?'snapshot' THEN RAISE EXCEPTION 'QA repeat claim can pay again';END IF;
 result:=jsonb_build_object('outcome','NO_SIMILARITY_FOUND','matches','[]'::jsonb,'note','No saved material to compare; originality is not established.','method','EMPTY_CORPUS');
 r:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);v:=(r->>'version')::integer;
 r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA completion receipt not replayed';END IF;
 r:=pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true),'pcs-manager-admin','["*"]');
 other:=pid;
 r:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','website','language','en','title','Similar','body','Similar semantic fixture text','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');pid:=(r->>'id')::uuid;v:=(r->>'version')::integer;
 r:=pcs.content_action('submit',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');snap:=r->'snapshot';
 IF snap->>'corpus_count'<>'1' OR snap#>>'{corpus,0,language}'<>'th' OR snap#>>'{corpus,0,body}'<>'Original semantic fixture text' THEN RAISE EXCEPTION 'QA full cross-language corpus missing';END IF;
 result:=jsonb_build_object('outcome','POSSIBLE_DUPLICATE','matches',jsonb_build_array(jsonb_build_object('post_id',other,'reason','Equivalent editorial angle and central offer.')),'note','Reviewer must decide whether the semantic overlap is justified.','method','AI_SEMANTIC_COMPARISON');
 r:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);v:=(r->>'version')::integer;
 denied:=false;BEGIN PERFORM pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true),'pcs-manager-admin','["*"]');EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA duplicate approved without review';END IF;
 r:=pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true,'duplicate_review_note','Reviewed overlap: this is an intentional language adaptation.'),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 r:=pcs.content_action('revise',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'platform','website','language','en','title','Revised','body','Revised fixture content','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 IF (SELECT content_duplicate_check FROM pcs.content_posts WHERE id=pid) IS NOT NULL THEN RAISE EXCEPTION 'QA edit retained check';END IF;
 r:=pcs.content_action('submit',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');snap:=r->'snapshot';
 PERFORM pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','telegram','language','ru','title','New corpus member','body','More fixture content','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');
 denied:=false;BEGIN PERFORM pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);EXCEPTION WHEN serialization_failure THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA changed corpus accepted';END IF;
 denied:=false;BEGIN PERFORM pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','[]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA denied receipt bypass';END IF;
 IF has_function_privilege('public','pcs.content_complete_duplicate_check(jsonb,text,jsonb,jsonb)','EXECUTE') OR has_function_privilege('public','pcs.content_duplicate_context(uuid)','EXECUTE') THEN RAISE EXCEPTION 'QA public function execute';END IF;

 -- A completed check also expires if the corpus changes before approval.
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');snap:=r->'snapshot';
 result:=jsonb_build_object('outcome','NO_SIMILARITY_FOUND','matches','[]'::jsonb,'note','Synthetic negative comparison within this bounded fixture corpus.','method','AI_SEMANTIC_COMPARISON');
 r:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);v:=(r->>'version')::integer;
 PERFORM pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','telegram','language','ru','title','Changed corpus again','body','New fixture corpus material','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');
 denied:=false;BEGIN PERFORM pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',2,'facts_checked',true),'pcs-manager-admin','["*"]');EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA stale completed check approved';END IF;
 -- Cached command receipts cannot bypass current staff revocation or bans.
 INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",banned) VALUES(auth_id,'QA semantic reviewer','qa-semantic-'||auth_id||'@example.invalid',false,now(),now(),false);
 PERFORM pcs.staff_manage(auth_id,'CONCIERGE_MANAGER',true);
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);r:=pcs.content_complete_duplicate_check(cmd,auth_id::text,'[]');snap:=r->'snapshot';
 r:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),auth_id::text,'[]',result);v:=(r->>'version')::integer;
 UPDATE neon_auth."user" SET banned=true WHERE id=auth_id;
 denied:=false;BEGIN PERFORM pcs.content_complete_duplicate_check(cmd,auth_id::text,'["*"]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA banned semantic receipt allowed';END IF;
 UPDATE neon_auth."user" SET banned=false WHERE id=auth_id;PERFORM pcs.staff_manage(auth_id,'AUDITOR_READONLY',true);
 denied:=false;BEGIN PERFORM pcs.content_complete_duplicate_check(cmd,auth_id::text,'["*"]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA revoked semantic receipt allowed';END IF;
 -- More than twelve materials remain explicitly truncated and require review.
 r:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','QA truncated corpus','guidelines','Only confirmed rollback facts without guarantees.'),'pcs-manager-admin','["*"]');brand:=(r#>>'{brand,id}')::uuid;
 FOR i IN 1..13 LOOP
  PERFORM pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','telegram','language','ru','title','Corpus '||i,'body','Full fixture body '||i,'source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');
 END LOOP;
 r:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',brand,'platform','website','language','en','title','Bounded candidate','body','Full candidate body','source_facts','Confirmed rollback fixture facts only','source_url','https://example.com/qa'),'pcs-manager-admin','["*"]');pid:=(r->>'id')::uuid;v:=(r->>'version')::integer;
 r:=pcs.content_action('submit',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v),'pcs-manager-admin','["*"]');v:=(r->>'version')::integer;
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v);r:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]');snap:=r->'snapshot';
 IF snap->>'corpus_count'<>'12' OR snap->>'corpus_truncated'<>'true' OR jsonb_array_length(snap->'corpus')<>12 OR EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'corpus') c WHERE c->>'title'='Corpus 1') THEN RAISE EXCEPTION 'QA corpus limit or ordering incorrect';END IF;
 r:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snap->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);v:=(r->>'version')::integer;
 denied:=false;BEGIN PERFORM pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true),'pcs-manager-admin','["*"]');EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'QA truncated history approved without note';END IF;
 PERFORM pcs.content_action('approve',jsonb_build_object('request_id',gen_random_uuid(),'id',pid,'expected_version',v,'revision',1,'facts_checked',true,'duplicate_review_note','Editor reviewed earlier history separately in this rollback fixture.'),'pcs-manager-admin','["*"]');
END $qa$;
