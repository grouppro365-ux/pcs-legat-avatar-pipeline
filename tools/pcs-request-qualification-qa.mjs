import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const check=read('tests/request-qualification-rollback.sql');
console.log(JSON.stringify({sql:'DO $outer$ BEGIN BEGIN EXECUTE $staff$'+read('server/sql/pcs_staff_accounts.sql')+'$staff$; EXECUTE $qualification$'+read('server/sql/pcs_request_qualification.sql')+'$qualification$; '+check+" RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$"}));
