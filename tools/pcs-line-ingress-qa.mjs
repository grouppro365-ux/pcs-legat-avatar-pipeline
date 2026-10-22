import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
console.log(JSON.stringify({sql:`DO $outer$ BEGIN BEGIN EXECUTE $install$${read('server/sql/pcs_line_ingress.sql')}$install$; EXECUTE $checks$${read('tests/line-ingress-rollback.sql')}$checks$; RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$;`}));
