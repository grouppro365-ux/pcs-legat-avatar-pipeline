import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const staff=read('server/sql/pcs_staff_accounts.sql'),base=read('server/sql/pcs_content_workflow.sql'),targets=read('server/sql/pcs_content_targets.sql'),checks=read('tests/content-targets-rollback.sql');
console.log(JSON.stringify({query:`DO $outer$ BEGIN BEGIN EXECUTE $staff$${staff}$staff$; EXECUTE $base$${base}$base$; EXECUTE $targets$${targets}$targets$; ${checks} RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $outer$;`}));
