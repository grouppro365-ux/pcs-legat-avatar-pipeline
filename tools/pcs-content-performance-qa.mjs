import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Run on the existing QA branch after access is restored. The outer caught
// exception rolls back migrations, synthetic fixtures, commands and audit rows.
const installs=['pcs_staff_accounts','pcs_content_workflow','pcs_content_duplicates','pcs_content_targets','pcs_content_publication_queue','pcs_content_publication_verify','pcs_content_performance'];
console.log(JSON.stringify({sql:`DO $performance_rollback$ BEGIN BEGIN ${installs.map((name,i)=>`EXECUTE $migration_${i}$${read('server/sql/'+name+'.sql')}$migration_${i}$;`).join('\n')} EXECUTE $checks$${read('tests/content-performance-rollback.sql')}$checks$; RAISE EXCEPTION 'performance QA rolled back' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $performance_rollback$;`}));
