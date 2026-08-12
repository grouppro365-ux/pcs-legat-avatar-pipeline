const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exit(1);}console.log('PASS:',m);}

const manifest=JSON.parse(read('manifest.json'));
ok(manifest.manifest_version===3,'Manifest V3');
ok(manifest.version==='0.1.0','version 0.1.0');
ok(manifest.background?.service_worker==='bootstrap.js','bootstrap service worker configured');
ok((manifest.permissions||[]).includes('debugger'),'trusted Enter fallback permission');
ok((manifest.permissions||[]).includes('alarms'),'MV3 run-resume alarm permission');

const core=read('browser_harness_core.js');
const client=read('browser_harness_client.js');
const planner=read('planner_protocol.js');
const worker=read('service_worker.js');
const tracker=read('target_tracker.js');
const bootstrap=read('bootstrap.js');
const ui=read('workbench.js');
const all=[core,client,planner,worker,tracker,bootstrap,ui].join('\n');

ok(/class Driver/.test(core),'Browser Harness Driver preserved');
ok(/class ElementProxy/.test(core),'Browser Harness ElementProxy preserved');
ok(/findElement/.test(core)&&/findVisible/.test(core)&&/waitFor\(/.test(core),'find/findVisible/waitFor preserved');
ok(/read-only condition/.test(core),'waitFor explicitly condition-only');
ok(!/\bexec\s*:/.test(core),'no mutation-inside-wait exec option');
ok(/sendReadOnly/.test(core)&&/sendMutationOnce/.test(core),'read and mutation transport separated');
ok(/navigation_after_delivery_loss/.test(core),'mutation delivery loss checks navigation instead of blind retry');
const mutationDef=core.match(/async sendMutationOnce\(message\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]||'';
ok(mutationDef&&!/sendMutationOnce\s*\(/.test(mutationDef),'mutation transport does not recursively resend itself');
ok((core.match(/this\.sendMutationOnce\s*\(/g)||[]).length===1,'act has exactly one mutation transport call');
ok(/timeoutMs\s*=\s*Number\(options\.timeoutMs \?\?/.test(core),'zero-timeout polling semantics preserved');

ok(/WeakMap/.test(client)&&/elementByRef/.test(client),'browser-side element proxy cache');
ok(/shadowRoot/.test(client),'open Shadow DOM traversal');
ok(/semantic_fallback/.test(client),'self-healing semantic locator fallback');
ok(/FIELD_VALUE_REVERTED/.test(client),'SPA fill postcondition check');
ok(/SELECT_VALUE_REVERTED/.test(client),'SPA select postcondition check');

ok(/validateResponse/.test(planner)&&/ALLOWED_ACTIONS/.test(planner),'typed planner JSON validation');
ok(/<REQUEST_ID_FROM_TOP>/.test(planner),'prompt schema cannot impersonate actual request id');
ok(/DONE_PROOF_REQUIRED/.test(planner),'done requires proof schema');

ok(/new Driver\(chatTab\.id\)/.test(worker),'ChatGPT uses the same generic Driver');
ok(/composerProxy\(chatDriver\)/.test(worker),'ChatGPT composer uses Harness element proxy');
ok(/chatDriver\.read\(\{maxChars:60000, tail:true\}\)/.test(worker),'ChatGPT response uses generic Harness read tail');
ok(/composer\.submit\(\)/.test(worker),'generic form submit is primary ChatGPT send');
ok(/scopedSendButton/.test(worker)&&/trustedEnter/.test(worker),'scoped Send and trusted Enter are fallbacks');
ok(/composerStillHasRequest/.test(worker),'resend fallback only while exact request remains in composer');
ok(!/activeRequest/.test(worker),'no bespoke ChatGPT activeRequest state machine');
ok(!/data-message-author-role/.test(worker),'no fragile ChatGPT assistant/user role selector');
ok(!/CHATGPT_SEND_UNCERTAIN_NO_RETRY/.test(worker),'old terminal uncertain-send protocol removed');
ok(/BH_PLANNER\.validateResponse/.test(worker),'planner output validated before browser action');
ok(/verifyDone/.test(worker)&&/DONE_PROOF/.test(planner),'completion verified against live browser state');
ok(/SECRET_FIELD_BLOCKED/.test(worker),'secret fields hard blocked');
ok(/HIGH_RISK_CONFIRM_REQUIRED/.test(worker),'high-risk confirmation gate exists');
const mutationPolicy=worker.match(/const MUTATION_RE\s*=\s*\/(.*?)\/i/)?.[1]||'';
ok(!/(submit|save|apply|сохран|примен)/i.test(mutationPolicy),'ordinary save/apply/submit do not interrupt user with confirmation');
ok(/async function adoptChildTab[\s\S]*?await putState\(state\)/.test(worker),'new child target is persisted before next Observe');
ok(/relatedRoutes/.test(worker),'successful routes are reusable hints');
ok(/chrome\.alarms/.test(worker),'run can be resumed by MV3 alarm');

ok(/pendingChildTabId/.test(tracker)&&/openerTabId/.test(tracker),'child tab handoff is also tracked asynchronously');
ok(/state\.target=next/.test(tracker),'same-tab navigation refreshes target metadata');
ok(/importScripts\('service_worker\.js','target_tracker\.js'\)/.test(bootstrap),'bootstrap loads runtime and tracker');

ok(!/api\.openai\.com|OPENAI_API_KEY|OpenRouter|TokenRouter|sk-proj-/i.test(all),'no paid AI API runtime');
ok(!/nowjs|phantomjs|asyncblock|express\s*3/i.test(all),'legacy Browser Harness transport/runtime removed');
ok(!/\beval\s*\(|\bFunction\s*\(/.test(all),'no raw eval/Function execution');
ok(/dragstart/.test(ui)&&/ABH_START_TASK/.test(ui),'drag Queue → Running starts a task');
ok(!/ABH_START_TASK.*done/i.test(ui),'UI has no manual drag-to-done completion path');

const readme=read('README.md');const license=read('LICENSE.browser-harness.txt');
ok(/scriby\/browser-harness/.test(readme),'Browser Harness provenance documented');
ok(/controller-side `Driver`/.test(readme)&&/ElementProxy/.test(readme),'preserved architecture documented');
ok(/Copyright \(c\) 2013 scriby/.test(license),'original MIT attribution retained');

console.log('ALL STATIC CHECKS PASS');
