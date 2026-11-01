import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('real FFmpeg operator captions preserve frame timing, private text, font and safe geometry',()=>{
 execFileSync('python',['-B','tests/test_video_captions.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:120000});
});
