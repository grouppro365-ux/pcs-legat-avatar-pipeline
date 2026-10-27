import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('private avatar stage receipts, compressed notebook compatibility and failure provenance',()=>{
 execFileSync('python',['-B','tests/test_avatar_runtime.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:30000});
});
