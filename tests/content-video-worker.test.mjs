import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('canonical video worker privacy, one-shot GPU launch and decoded source artifact checks',()=>{
 execFileSync('python',['-B','tests/test_content_video_worker.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
});
