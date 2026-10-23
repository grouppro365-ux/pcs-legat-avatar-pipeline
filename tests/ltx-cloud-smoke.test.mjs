import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('cloud LTX preparation, privacy and real encoded artifact QA',()=>{
 execFileSync('python',['-B','tests/test_ltx_cloud.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:30000});
});
