const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exit(1);}console.log('PASS:',m);}

const manifest=JSON.parse(read('manifest.json'));
const core=read('browser_harness_core.js');
const client=read('browser_harness_client.js');
const planner=read('planner_protocol.js');
const worker=read('service_worker.js');
const observer=read('chatgpt_observer.js');
const tracker=read('target_tracker.js');
const bootstrap=read('bootstrap.js');
const ui=read('workbench.js');
const seoRuntime=read('seo_article_writer_tatyana.js');
const seoSkill=read('skills/seo-article-writer-tatyana/SKILL.md');
const all=[core,client,planner,worker,observer,tracker,bootstrap,ui,seoRuntime,seoSkill].join('\n');

ok(manifest.manifest_version===3,'Manifest V3');
ok(manifest.version==='0.3.0','version 0.3.0');
ok(manifest.background?.service_worker==='bootstrap.js','bootstrap service worker configured');
ok((manifest.permissions||[]).includes('debugger'),'trusted Enter permission');
ok((manifest.permissions||[]).includes('alarms'),'durable alarm permission');
const chatContent=manifest.content_scripts.find(x=>(x.matches||[]).some(m=>m.includes('chatgpt.com')));
ok(!!chatContent,'ChatGPT-specific observer content script configured');
ok(chatContent.js.includes('planner_protocol.js')&&chatContent.js.includes('chatgpt_observer.js'),'observer loads parser before watcher');

ok(/class Driver/.test(core),'Browser Harness Driver preserved');
ok(/class ElementProxy/.test(core),'Browser Harness ElementProxy preserved');
ok(/findElement/.test(core)&&/findVisible/.test(core)&&/waitFor\(/.test(core),'find/findVisible/waitFor preserved');
ok(/sendReadOnly/.test(core)&&/sendMutationOnce/.test(core),'read and mutation transport separated');
ok(/navigation_after_delivery_loss/.test(core),'mutation loss checks navigation instead of blind retry');
ok(/WeakMap/.test(client)&&/elementByRef/.test(client),'browser-side element proxy cache');
ok(/shadowRoot/.test(client),'open Shadow DOM traversal');
ok(/collectDocuments/.test(client)&&/contentDocument/.test(client),'same-origin iframe traversal for CMS editor canvases');
ok(/queryAcrossDocuments/.test(client)&&/readAllText/.test(client),'find/read operate across same-origin iframe documents');
ok(/frameDepth/.test(client)&&/topRect/.test(client),'iframe elements preserve frame context and top-relative geometry');
ok(/Cross-origin frame:[\s\S]*opaque/.test(client),'cross-origin iframe boundary is fail-closed');
ok(/semantic_fallback/.test(client),'self-healing semantic locator fallback');
ok(/FIELD_VALUE_REVERTED/.test(client),'SPA fill postcondition');

ok(/shouldUseSeoSkill/.test(planner),'embedded skill is task-conditional');
ok(/MAX_ACTION_BUNDLE\s*=\s*12/.test(planner),'small local action bundles supported');
ok(/ACTION_BUNDLE_TOO_LARGE/.test(planner),'action bundle bounded');
ok(/PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP/.test(planner),'completed item requires verification as final action');
ok(/collectRequestScopedObjects/.test(planner),'requestId-scoped JSON parser retained');
ok(/DONE_PROOF_REQUIRED/.test(planner),'done requires live proof schema');

ok(/new MutationObserver/.test(observer),'ChatGPT response collection is event-driven');
ok(/ABH_CHAT_ARM/.test(observer)&&/ABH_CHAT_RECOVER/.test(observer),'observer arm/recovery protocol present');
ok(/chrome\.storage\.local\.set/.test(observer)&&/ABH_CHAT_RESPONSE/.test(observer),'observer persists then signals response');
ok(/acknowledged/.test(observer)&&/chrome\.storage\.local\.remove\(key\)/.test(observer),'response mailbox cleaned only after runtime ACK');
ok(!/setInterval\s*\(/.test(observer),'observer has no polling interval');

ok(/waiting_chatgpt/.test(worker),'durable waiting_chatgpt state exists');
ok(/ABH_CHAT_RESPONSE/.test(worker),'service worker consumes observer event');
ok(/recoverPendingChat/.test(worker),'pending response recovery exists');
ok(!/CHATGPT_RESPONSE_TIMEOUT/.test(worker),'terminal ChatGPT response timeout removed');
ok(!/waitPlannerResponse/.test(worker),'service worker chat polling loop removed');
ok(/CHATGPT_COMPOSER_MISMATCH/.test(worker),'exact composer equality gate exists');
ok(/ABH_CHAT_SENT_PROOF/.test(worker),'send proof checked outside composer');
ok(/Once the prompt left the exact composer state, never resend/.test(worker),'confirmed/uncertain send is never blindly resent');
ok(/BATCH_MAX_STEPS\s*=\s*500/.test(worker),'batch action budget 500');
ok(/expectedTotal/.test(worker)&&/BATCH_SCOPE_INCOMPLETE/.test(worker),'finite batch completion enforced');
ok(/batchGate/.test(worker),'first verified batch item checkpoint stored');
ok(/executePlannerBundle/.test(worker),'local deterministic action bundle executor exists');
ok(/pageChanged/.test(worker),'bundle stops after page change');
ok(/SECRET_FIELD_BLOCKED/.test(worker),'secret field gate exists');
ok(/HIGH_RISK_CONFIRM_REQUIRED/.test(worker),'high-risk confirmation exists');
ok(/async function ensureGenericClient\(tabId\)[\s\S]*new Driver\(tabId\)/.test(worker)&&/ensureGenericClient\(chatTab\.id\)/.test(worker),'ChatGPT input uses the same generic Browser Harness Driver');
ok(/chrome\.alarms/.test(worker),'MV3 recovery alarm exists');

ok(/chrome\.storage\.onChanged/.test(tracker)&&/reconciling/.test(tracker),'target metadata self-reconciles after navigation/storage races');
ok(/importScripts\('seo_article_writer_tatyana\.js','service_worker\.js','target_tracker\.js'\)/.test(bootstrap),'skill loads before runtime');
ok(/name: seo-article-writer-tatyana/.test(seoSkill)&&/version: "1\.0\.0"/.test(seoSkill),'canonical SEO skill bundled');
ok(/IndexNow alone is never/.test(seoRuntime),'SEO runtime forbids indexing-only substitution');
ok(/Rank Math/.test(seoRuntime)&&/Process one article to verified completion/.test(seoRuntime),'SEO runtime requires substantive per-article work');
ok(/waiting_chatgpt/.test(ui)&&/articles/.test(ui),'Workbench exposes durable phase and batch progress');

ok(!/api\.openai\.com|OPENAI_API_KEY|OpenRouter|TokenRouter|sk-proj-/i.test(all),'no paid AI API runtime');
ok(!/nowjs|phantomjs|asyncblock|express\s*3/i.test(all),'legacy Browser Harness transport removed');
ok(!/\beval\s*\(|\bFunction\s*\(/.test(all),'no raw eval/Function execution');
ok(/dragstart/.test(ui)&&/ABH_START_TASK/.test(ui),'drag Queue → Running still starts task');

const readme=read('README.md'),license=read('LICENSE.browser-harness.txt');
ok(/scriby\/browser-harness/.test(readme),'Browser Harness provenance documented');
ok(/Copyright \(c\) 2013 scriby/.test(license),'original MIT attribution retained');

console.log('ALL STATIC CHECKS PASS');
