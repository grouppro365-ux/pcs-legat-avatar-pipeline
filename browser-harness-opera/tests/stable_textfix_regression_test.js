const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const gitBlobSha=content=>crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
function ok(v,msg){if(!v){console.error('FAIL:',msg);process.exit(1);}console.log('PASS:',msg);}

const manifest=JSON.parse(read('manifest.json'));
const worker=read('service_worker.js');
const core=read('browser_harness_core.js');
const tracker=read('target_tracker.js');
const client=read('browser_harness_client.js');
const bootstrap=read('bootstrap.js');
const planner=read('planner_protocol.js');
const ui=read('workbench.html');

// Hard freeze of the last user-observed working target-side runtime.
ok(gitBlobSha(worker)==='5c1a199bef7e3962fd4a6f37b1a023d85984c233','v0.1.1 service_worker base unchanged');
ok(gitBlobSha(core)==='00c7bf25963c917b175161d18a8219e45a90456f','v0.1.1 Driver/core unchanged');
ok(gitBlobSha(tracker)==='0c9f6e5deae659d06d659848c3a9a82c8e4873fc','v0.1.1 target tracker unchanged');

ok(manifest.version==='0.1.3','stable release version 0.1.3');
ok(!/chatgpt_observer|ABH_CHAT_ARM|waiting_chatgpt|mailbox/i.test(worker+bootstrap),'no v0.3 observer/event transport');
ok(/chatDriver\.read\(\{maxChars:60000, tail:true\}\)/.test(worker),'original service-worker code retained underneath transport override');
ok(/collectRequestScopedObjects/.test(planner),'requestId-scoped parser retained');
ok(/ABH_SKILLS\?\.seoArticleWriterTatyana/.test(planner),'embedded SEO skill injected into planner');
ok(/seo_article_writer_tatyana\.js/.test(bootstrap),'SEO skill loaded before runtime');
ok(/chat_transport_v94\.js/.test(bootstrap),'deterministic ChatGPT transport loaded as isolated override');

// Existing CMS editor fix remains byte-for-byte unchanged from v0.1.2 STABLE.
ok(/function collectDocuments/.test(client)&&/contentDocument/.test(client),'same-origin editor iframe traversal enabled');
ok(/const docOf = el => el\?\.ownerDocument/.test(client),'editable field uses owning document');
ok(/doc\.execCommand\('insertText'/.test(client),'contenteditable replacement uses editor document transaction');
ok(/function readAllText/.test(client),'planner can read article text inside editor iframe');
ok(/queryAcrossDocuments/.test(client),'locator can resolve controls inside same-origin editor iframe');
ok(/v0\.1\.3 STABLE/.test(ui),'UI identifies stable ChatGPT transport build');

console.log('stable_textfix_regression_test PASS');
