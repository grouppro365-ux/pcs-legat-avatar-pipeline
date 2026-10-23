import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('FFmpeg platform exports, real multishot decoding and technical rejection',()=>{
 execFileSync('python',['-B','tests/test_video_postprocess.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:120000});
});
