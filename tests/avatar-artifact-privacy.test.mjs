import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('successful private avatar runs upload only sanitized diagnostics and the pinned run identity',()=>{
 const workflow=read('.github/workflows/daily-kaggle.yml');
 const step=workflow.split('- name: Upload sanitized avatar execution diagnostics')[1];
 assert.ok(step);assert.match(step,/success\(\).*avatar/);
 const paths=step.split('path: |')[1].split('if-no-files-found:')[0].trim().split('\n').map(x=>x.trim());
 assert.deepEqual(paths,['kaggle-output/pcs-gpu-diagnostics.json','kaggle-run.json']);
 assert.match(step,/name: pcs-avatar-run-diagnostics/);
 assert.doesNotMatch(step,/\*|qa_report|run_manifest|\.mp4|\.ipynb|\.log/);
});
test('the publication stop workflow cancels only the shared GitHub monitor and cannot launch another GPU',()=>{
 const guard=read('.github/workflows/pcs-avatar-output-guard.yml');
 assert.match(guard,/group: pcs-legat-existing-kaggle\n  cancel-in-progress: true/);
 assert.match(guard,/paths: \['.github\/workflows\/pcs-avatar-output-guard.yml'\]/);
 assert.doesNotMatch(guard,/secrets\.|kernels_push|kernels_cancel|python |uses:|curl|wget/);
});
