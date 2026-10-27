import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('private avatar stage receipts, compressed notebook compatibility and failure provenance',()=>{
 for(const file of ['tests/test_avatar_runtime.py','tests/test_avatar_diagnostic_codes.py'])execFileSync('python',['-B',file],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:30000});
});
