import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
console.log(JSON.stringify({sql:`DO $outer$ BEGIN BEGIN EXECUTE $staff$${read('server/sql/pcs_staff_accounts.sql')}$staff$; EXECUTE $install$${read('server/sql/pcs_source_qualification.sql')}$install$; ${read('tests/source-qualification-rollback.sql')} RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$;`}));
