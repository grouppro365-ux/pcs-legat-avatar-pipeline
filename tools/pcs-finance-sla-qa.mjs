import {readFileSync} from 'node:fs';
import {clientPaymentsQuery} from '../server/supabase/pcs-manager-live2/client-payments.mjs';
import {slaEscalationQuery} from '../server/supabase/pcs-manager-live2/sla-escalation.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const portal=read('server/sql/pcs_portal_workflow.sql');
const finance=read('tests/client-payments-rollback.sql').replaceAll('__FINANCE__',()=>clientPaymentsQuery);
const sla=read('tests/sla-escalation-rollback.sql').replaceAll('__SLA__',()=>slaEscalationQuery);
console.log(JSON.stringify({sql:'DO $outer$ BEGIN BEGIN EXECUTE $portal$'+portal+'$portal$; '+finance+' '+sla+" RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$"}));
