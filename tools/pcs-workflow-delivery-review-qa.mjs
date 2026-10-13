import {readFileSync} from 'node:fs';import {reviewWorkflowDeliveryQuery,workflowDeliveryList} from '../server/supabase/pcs-manager-live2/workflow-delivery-review.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const check=read('tests/workflow-delivery-review-rollback.sql').replaceAll('__REVIEW__',()=>reviewWorkflowDeliveryQuery).replaceAll('__LIST__',()=>workflowDeliveryList);
// Existing staff functions are included only inside the rolled-back QA transaction.
console.log(JSON.stringify({sql:'DO $outer$ BEGIN BEGIN EXECUTE $staff$'+read('server/sql/pcs_staff_accounts.sql')+'$staff$; '+check+" RAISE EXCEPTION 'QA rollback complete' USING ERRCODE='Z0001'; EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END; END $outer$"}));
