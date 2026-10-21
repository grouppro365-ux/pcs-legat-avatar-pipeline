import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const staff=read('../server/sql/pcs_staff_accounts.sql'),base=read('../server/sql/pcs_content_workflow.sql'),duplicates=read('../server/sql/pcs_content_duplicates.sql'),checks=read('../tests/content-duplicates-rollback.sql');
console.log(JSON.stringify({query:`DO $outer$ BEGIN BEGIN EXECUTE $staff$${staff}$staff$; EXECUTE $base$${base}$base$; EXECUTE $duplicates$${duplicates}$duplicates$; ${checks} RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $outer$;`}));
