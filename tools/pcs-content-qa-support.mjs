// Synthetic semantic observations for rollback QA only; never a real model result.
export const duplicateFixtureHelper=`CREATE OR REPLACE FUNCTION pcs.qa_content_check(p_id uuid,p_version integer) RETURNS integer LANGUAGE plpgsql AS $fixture$
DECLARE cmd jsonb:=jsonb_build_object('request_id',gen_random_uuid(),'id',p_id,'expected_version',p_version); prepared jsonb; snapshot jsonb; result jsonb; receipt jsonb;
BEGIN
 prepared:=pcs.content_complete_duplicate_check(cmd,'pcs-manager-admin','["*"]'); snapshot:=prepared->'snapshot';
 result:=jsonb_build_object('outcome','NO_SIMILARITY_FOUND','matches','[]'::jsonb,'note','Synthetic rollback fixture observation; no real model was invoked.','method',CASE WHEN snapshot->>'corpus_count'='0' THEN 'EMPTY_CORPUS' ELSE 'AI_SEMANTIC_COMPARISON' END);
 receipt:=pcs.content_complete_duplicate_check(cmd||jsonb_build_object('snapshot_signature',snapshot->>'snapshot_signature'),'pcs-manager-admin','["*"]',result);
 RETURN (receipt->>'version')::integer;
END $fixture$;`;
