import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const installs=['pcs_staff_accounts','pcs_content_workflow','pcs_content_duplicates','pcs_content_targets','pcs_content_publication_queue','pcs_content_video'];
console.log(JSON.stringify({sql:`DO $video_rollback$ BEGIN BEGIN ${installs.map((name,i)=>`EXECUTE $migration_${i}$${read('server/sql/'+name+'.sql')}$migration_${i}$;`).join('\n')} EXECUTE $checks$${read('tests/content-video-rollback.sql')}$checks$; RAISE EXCEPTION 'video QA rolled back' USING ERRCODE='Z0001';EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;END $video_rollback$;`}));
