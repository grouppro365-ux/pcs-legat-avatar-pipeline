const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
function read(f){return fs.readFileSync(path.join(root,f),'utf8');}
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}

const manifest=JSON.parse(read('manifest.json'));
ok(manifest.manifest_version===3,'Manifest V3');
ok(manifest.version==='2.0.3','version 2.0.3');
ok(manifest.background?.service_worker==='service_worker_v203.js','v2.0.3 migration wrapper configured');
ok((manifest.permissions||[]).includes('debugger'),'debugger permission for trusted ChatGPT input');
ok((manifest.content_scripts||[]).some(x=>(x.js||[]).join(',').includes('response_parser.js,chat_response_matcher.js,chatgpt_adapter.js')),'ChatGPT parser and matcher load before adapter');
ok((manifest.content_scripts||[]).some(x=>(x.js||[]).join(',').includes('locator_engine.js,page_agent.js')),'locator engine loads before page agent');

const files=['service_worker_v203.js','service_worker_v2.js','response_parser.js','chat_response_matcher.js','chat_cdp.js','policy.js','locator_engine.js','page_agent.js','chatgpt_adapter.js','popup.js'];
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

const adapter=read('chatgpt_adapter.js');
ok(/function releaseRequest\(requestId\)/.test(adapter),'ChatGPT request slot has guarded release helper');
const successReport=adapter.indexOf("await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:true");
const releaseBeforeSuccess=adapter.lastIndexOf('releaseRequest(requestId);', successReport);
ok(successReport>0&&releaseBeforeSuccess>0&&releaseBeforeSuccess<successReport,'request slot is released before RESULT round-trip can re-enter next step');
ok(/if \(activeRequest === requestId\) activeRequest = null/.test(adapter),'older async frame cannot clear a newer request');
ok(/busy:!!activeRequest/.test(adapter),'ChatGPT PING exposes harness busy state for diagnostics');
ok(/findUserAnchor/.test(adapter)&&/collectTextAfterUser/.test(adapter),'response detection is anchored after the exact user turn');
ok(/data-turn=\\"assistant\\"/.test(adapter)||/data-turn="assistant"/.test(adapter),'response detector has assistant-turn fallback selector');
ok(/turnContainers/.test(adapter)&&/article/.test(adapter),'response detector supports generic ChatGPT turn wrappers');
ok(/Node\.DOCUMENT_POSITION_FOLLOWING/.test(adapter),'response recovery uses DOM order rather than page-wide text guessing');
ok(/AUH_CHAT_RECOVER/.test(adapter),'adapter exposes non-resending DOM recovery endpoint');
ok(/CHATGPT_RESPONSE_TIMEOUT/.test(adapter)&&/const recovered = findAssistantResult\(requestId\)/.test(adapter),'timeout performs final live-DOM recovery before failure');
ok(/ADAPTER_VERSION = '2\.0\.3'/.test(adapter),'adapter version handshake is current');

const matcher=read('chat_response_matcher.js');
ok(/joined_fragments/.test(matcher)&&/parts\.slice\(i\)\.join/.test(matcher),'fragmented ChatGPT JSON can be reassembled');
ok(/obj\.requestId === requestId/.test(matcher),'matcher requires exact requestId');

const bootstrap=read('service_worker_v203.js');
ok(/AUH_RUNTIME_VERSION = '2\.0\.3'/.test(bootstrap),'runtime bootstrap version is current');
ok(/chrome\.tabs\.reload\(chatTabId\)/.test(bootstrap),'bound ChatGPT tab is refreshed once after runtime upgrade');
ok(!/reload\([^)]*target/i.test(bootstrap),'working site is never auto-reloaded during upgrade');

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

console.log('ALL V2.0.3 STATIC CHECKS PASS');
