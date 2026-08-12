const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(f){return fs.readFileSync(path.join(root,f),'utf8');}
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}
const manifest=JSON.parse(read('manifest.json'));
ok(manifest.manifest_version===3,'Manifest V3');
ok(manifest.version==='1.0.0','version 1.0.0');
ok(manifest.background?.service_worker==='service_worker.js','service worker configured');
const files=['service_worker.js','policy.js','page_agent.js','chatgpt_adapter.js','popup.js'];
const all=files.map(read).join('\n');
ok(!/api\.openai\.com|OPENAI_API_KEY|sk-proj-/i.test(all),'no paid OpenAI API references');
ok(!/\b(?:eval|Function)\s*\(/.test(all),'no raw eval/Function execution protocol');
ok(!/nowjs|phantomjs|express\s*3|asyncblock/i.test(all),'no legacy Browser Harness runtime dependencies');
ok(/CROSS_ORIGIN_REBIND_REQUIRED/.test(all),'cross-origin fail-closed guard exists');
ok(/SECRET_FIELD_BLOCKED/.test(all),'secret field guard exists');
ok(/CONFIRM_REQUIRED/.test(all),'dangerous action confirmation exists');
ok(/DONE_REJECTED_UNVERIFIED_ACTION/.test(all),'verify-before-done gate exists');
ok(/SAFETY_CHAT_SWITCH/.test(all),'pinned ChatGPT conversation guard exists');
ok(/CHATGPT_SEND_UNCERTAIN_NO_RETRY/.test(all),'no blind resend after uncertain ChatGPT send');
ok(/MAX_STEPS/.test(read('service_worker.js')),'bounded runaway protection exists');
ok(/routes/.test(read('service_worker.js')) && /abstractAction/.test(read('policy.js')),'route learning stores abstract actions');
console.log('ALL STATIC CHECKS PASS');
