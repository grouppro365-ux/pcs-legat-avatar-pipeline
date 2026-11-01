import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Run ONLY on the existing dedicated QA branch. The caught exception rolls back
// every migration, synthetic fixture, command, outbox change and audit row.
// Includes the existing TEXT lifecycle QA before the new VIDEO acceptance.
const installs=['pcs_staff_accounts','pcs_content_workflow','pcs_content_duplicates','pcs_content_targets','pcs_content_publication_queue','pcs_content_publication_verify','pcs_content_video'];
const checks=['content-publication-queue-rollback','content-video-publication-rollback'];
console.log(JSON.stringify({sql:`DO $video_publication_rollback$ BEGIN BEGIN ${installs.map((name,i)=>`EXECUTE $migration_${i}$${read('server/sql/'+name+'.sql')}$migration_${i}$;`).join('\n')} ${checks.map((name,i)=>`EXECUTE $checks_${i}$${read('tests/'+name+'.sql')}$checks_${i}$;`).join('\n')} RAISE EXCEPTION 'video publication QA rolled back' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $video_publication_rollback$;`}));
