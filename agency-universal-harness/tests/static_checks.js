const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
function read(f){return fs.readFileSync(path.join(root,f),'utf8');}
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}

const manifest=JSON.parse(read('manifest.json'));
ok(manifest.manifest_version===3,'Manifest V3');
ok(manifest.version==='2.0.1','version 2.0.1');
ok(manifest.background?.service_worker==='service_worker_v2.js','v2 resilient service worker configured');
ok((manifest.permissions||[]).includes('debugger'),'debugger permission for trusted ChatGPT input');
ok((manifest.content_scripts||[]).some(x=>(x.js||[]).join(',').includes('locator_engine.js,page_agent.js')),'locator engine loads before page agent');

const files=['service_worker_v2.js','response_parser.js','chat_cdp.js','policy.js','locator_engine.js','page_agent.js','chatgpt_adapter.js','popup.js'];
const all=files.map(read).join('\n');
ok(!/api\.openai\.com|OPENAI_API_KEY|sk-proj-/i.test(all),'no paid OpenAI API references');
ok(!/\b(?:eval|Function)\s*\(/.test(all),'no raw eval/Function execution protocol');
ok(!/nowjs|phantomjs|express\s*3|asyncblock/i.test(all),'no legacy Browser Harness runtime dependencies');
ok(/SECRET_FIELD_BLOCKED/.test(all),'secret field guard exists');
ok(/CONFIRM_REQUIRED/.test(all),'dangerous action confirmation exists');
ok(/SAFETY_CHAT_SWITCH/.test(all),'pinned ChatGPT conversation guard exists');
ok(/CHATGPT_SEND_UNCERTAIN_NO_RETRY/.test(all),'no blind resend after uncertain ChatGPT send');
ok(/Input\.insertText/.test(read('chat_cdp.js')),'ChatGPT prompt uses CDP trusted input');
ok(/Input\.dispatchKeyEvent/.test(read('chat_cdp.js'))&&/Enter/.test(read('chat_cdp.js')),'ChatGPT submit uses CDP trusted Enter');
ok(!/new KeyboardEvent/.test(read('chatgpt_adapter.js')),'synthetic KeyboardEvent submit removed');
ok(/waitForUserEcho/.test(read('chatgpt_adapter.js')),'send requires user-turn postcondition');
ok(/collectTopLevelObjects/.test(read('response_parser.js')),'nested JSON response protection exists');

const page=read('page_agent.js');const worker=read('service_worker_v2.js');const locator=read('locator_engine.js');const policy=read('policy.js');
ok(/new WeakMap\(\)/.test(page)&&/refFor\(/.test(page),'DOM elements keep stable refs across scans');
ok(!/refs\.clear\(\)/.test(page),'scan never invalidates every ref');
ok(/exact_ref/.test(locator)&&/stable_hint/.test(locator)&&/semantic_fallback/.test(locator),'self-healing locator cascade exists');
ok(/LOCATOR_AMBIGUOUS/.test(locator)&&/LOCATOR_NOT_FOUND/.test(locator),'locator fails safely when recovery is uncertain');
ok(/shadowRoot/.test(locator)&&/collectRoot/.test(locator),'open shadow DOM is traversed');
ok(/viewportRank/.test(locator),'interactive scan prioritizes viewport controls');
ok(/recoverRun/.test(worker)&&/MAX_RECOVERIES/.test(worker),'recoverable errors trigger bounded replan loop');
ok(/snapshotTargets/.test(worker)&&/targets:snapshotTargets/.test(worker),'planner snapshot preserves original target descriptors');
ok(/enrichAction\(action,plan\)/.test(worker),'execution enriches action from the original plan snapshot');

const executeBody=worker.match(/async function executeAction[\s\S]*?\n}\n\nasync function verifyProof/)?.[0]||'';
ok(executeBody&&!/scanTarget\(state\)/.test(executeBody),'executeAction does not rescan and invalidate refs before acting');
ok(/FIELD_VALUE_REVERTED/.test(page)&&/stableValue/.test(page),'SPA-controlled fill is rechecked after event propagation');
ok(/SELECT_VALUE_REVERTED/.test(page),'SPA-controlled select is rechecked after event propagation');
ok(/DONE_REJECTED_PROOF_NOT_VERIFIED/.test(worker)&&/async function verifyProof/.test(worker),'done requires proof verified against the real page');
ok(!/last_action/.test(worker),'last action alone can never prove task completion');
ok(/kind==='element'/.test(worker)&&/type:'assert'/.test(worker),'element completion proof is independently asserted on live DOM');
ok(/crossOriginNavigateNeedsConfirmation/.test(worker),'invented cross-origin navigate requires confirmation');
ok(/destinationWasVisibleLink/.test(worker)&&/hostnameMentionedByUser/.test(worker),'cross-origin navigation can proceed only from visible link or explicit user domain without confirmation');
ok(/relatedRoutes/.test(worker)&&/ИЗВЕСТНЫЕ УСПЕШНЫЕ МАРШРУТЫ/.test(worker),'learned routes are reused as planner hints');
ok(/check','uncheck','hover','scroll/.test(policy),'generic action vocabulary expanded');
ok(/CROSS_ORIGIN_FORM_BLOCKED/.test(page),'cross-origin form submission remains blocked');
ok(/MAX_STEPS/.test(worker),'bounded runaway protection exists');
ok(/run\.error/.test(read('popup.js')),'concrete runtime error is visible in popup');
ok(/\/50/.test(read('popup.js'))&&/recoveries/.test(read('popup.js')),'popup exposes v2 step and recovery progress');

console.log('ALL V2.0.1 STATIC CHECKS PASS');
