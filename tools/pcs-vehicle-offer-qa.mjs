import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const portal=read('server/sql/pcs_portal_workflow.sql');
const funcs=['portal_home','portal_action'].map(name=>portal.match(new RegExp('CREATE OR REPLACE FUNCTION pcs\\.'+name+'\\([\\s\\S]*?END \\$fn\\$;'))[0]);
const migration=read('server/sql/pcs_vehicle_offer_booking.sql')+'\n'+funcs.join('\n');
console.log(JSON.stringify(process.argv.includes('--migration')?{sql:migration}:{sql:'DO $outer$ BEGIN BEGIN EXECUTE $migration$'+portal+'\n'+migration+'$migration$; '+read('tests/vehicle-offer-rollback.sql')+' '+read('tests/portal-workflow-rollback.sql')+" RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$"}));
