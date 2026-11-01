-- Synthetic canonical-schema acceptance; no HTTP, messages or publication.
DO $qa$
DECLARE b uuid; pid uuid; cmd jsonb; prepared jsonb; evidence jsonb; result jsonb; version integer; denied boolean; digest text;
BEGIN
 result:=pcs.content_action('brand',jsonb_build_object('request_id',gen_random_uuid(),'name','PCS synthetic performance rollback QA','guidelines','Synthetic local rollback fixture only. Never publish.'),'pcs-manager-admin','["*"]');
 b:=(result#>>'{brand,id}')::uuid;
 result:=pcs.content_action('create',jsonb_build_object('request_id',gen_random_uuid(),'brand_id',b,'platform','telegram','language','en','title','Synthetic performance QA','body','Synthetic rollback evidence only.','source_facts','Synthetic rollback fixture, no actual claims or public counts.','source_url','https://example.invalid/pcs-rollback'),'pcs-manager-admin','["*"]');
 pid:=(result->>'id')::uuid;version:=(result->>'version')::integer;
 -- Fixture setup is not a claim that an editor approved or published anything.
 UPDATE pcs.content_posts SET status='PUBLICATION_REPORTED',approved_revision=1,publication_url='https://t.me/pcs_synthetic_qa/42' WHERE id=pid;
 cmd:=jsonb_build_object('id',pid,'request_id',gen_random_uuid(),'expected_version',version);
 prepared:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]');
 digest:=encode(sha256(convert_to('Synthetic rollback evidence only.','UTF8')),'hex');
 evidence:=jsonb_build_object('method','public_telegram_views_v1','outcome','OBSERVED','reason','counter_observed','publication_url','https://t.me/pcs_synthetic_qa/42','fetch_url','https://t.me/s/pcs_synthetic_qa?before=43','username','pcs_synthetic_qa','message_id','42','expected_sha256',digest,'observed_sha256',digest,'published_at','2026-10-31T00:00:00Z','snapshot_signature',prepared#>>'{snapshot,snapshot_signature}','views',jsonb_build_object('display','1.2K','exact',NULL,'estimate','1200','approximate',true));
 result:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]',evidence);
 version:=(result->>'version')::integer;
 IF result#>>'{observation,outcome}'<>'OBSERVED' OR result#>>'{observation,views,estimate}'<>'1200' OR result#>>'{observation,views,exact}' IS NOT NULL OR result->>'status'<>'PUBLICATION_REPORTED' THEN RAISE EXCEPTION 'QA approximate observation contract';END IF;
 result:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]');
 IF result->>'replayed'<>'true' THEN RAISE EXCEPTION 'QA observation replay';END IF;
 denied:=false;BEGIN PERFORM pcs.content_observe_performance(cmd,'pcs-manager-admin','[]');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'QA revoked permission replay';END IF;
 cmd:=jsonb_build_object('id',pid,'request_id',gen_random_uuid(),'expected_version',version);
 prepared:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]');
 evidence:=evidence||jsonb_build_object('snapshot_signature',prepared#>>'{snapshot,snapshot_signature}','outcome','UNAVAILABLE','reason','counter_missing','views',NULL);
 result:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]',evidence);version:=(result->>'version')::integer;
 IF result#>'{observation,views}' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'QA missing counter became zero';END IF;
 cmd:=jsonb_build_object('id',pid,'request_id',gen_random_uuid(),'expected_version',version);
 prepared:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]');
 evidence:=evidence||jsonb_build_object('snapshot_signature',prepared#>>'{snapshot,snapshot_signature}','outcome','OBSERVED','reason','counter_observed','views',jsonb_build_object('display','0','exact','0','estimate',NULL,'approximate',false));
 result:=pcs.content_observe_performance(cmd,'pcs-manager-admin','["*"]',evidence);
 IF result#>>'{observation,views,exact}'<>'0' OR (SELECT count(*) FROM pcs.content_performance_observations WHERE post_id=pid)<>3 THEN RAISE EXCEPTION 'QA exact zero or history';END IF;
 denied:=false;BEGIN DELETE FROM pcs.content_performance_observations WHERE post_id=pid;EXCEPTION WHEN object_not_in_prerequisite_state THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'QA mutable performance history';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='pcs.content_observe_performance(jsonb,text,jsonb,jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'QA public performance execution';END IF;
END $qa$;
