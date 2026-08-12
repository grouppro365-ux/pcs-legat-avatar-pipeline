import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const required = ['manifest.json','background.js','policy.js','page-agent.js','chatgpt-bridge.js','dashboard.html','dashboard.js','README.md'];
for (const f of required) {
  if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
}

const manifest = JSON.parse(fs.readFileSync('manifest.json','utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (manifest.version !== '0.3.0') throw new Error(`unexpected version ${manifest.version}`);
if (manifest.background?.service_worker !== 'background.js') throw new Error('background service worker mismatch');
for (const p of ['tabs','scripting','storage']) if (!manifest.permissions?.includes(p)) throw new Error(`missing permission ${p}`);
if (!manifest.host_permissions?.some(x=>x.includes('chatgpt.com'))) throw new Error('missing ChatGPT host permission');
if (!manifest.host_permissions?.includes('https://*/*')) throw new Error('missing https host permission');

for (const f of ['background.js','policy.js','page-agent.js','chatgpt-bridge.js','dashboard.js']) {
  execFileSync(process.execPath,['--check',f],{stdio:'inherit'});
}

const runtime = ['background.js','policy.js','page-agent.js','chatgpt-bridge.js','dashboard.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
const forbidden = ['api.openai.com','OPENAI_API_KEY','sk-proj-','Bearer sk-'];
for (const s of forbidden) if (runtime.includes(s)) throw new Error(`forbidden runtime string: ${s}`);

const invariants = [
  ['background.js','ensureScript'],
  ['background.js','AGENCY_CHAT_PING'],
  ['background.js','AGENCY_PAGE_PING'],
  ['background.js','conversationKey'],
  ['background.js','currentOrigin !== binding.origin'],
  ['background.js','requiresConfirmation'],
  ['background.js','usedConfirmations'],
  ['page-agent.js','externalOrigin'],
  ['page-agent.js','sensitive: isSensitive'],
  ['page-agent.js','AGENCY_VERIFY'],
  ['dashboard.js','requestId!==requestId'],
  ['dashboard.js','VERIFY_TARGET'],
  ['dashboard.js','Достигнут лимит 24 шагов'],
  ['chatgpt-bridge.js','AGENCY_CHAT_ASK'],
  ['chatgpt-bridge.js','findComposer']
];
for (const [file,needle] of invariants) {
  const text=fs.readFileSync(file,'utf8');
  if(!text.includes(needle)) throw new Error(`invariant missing: ${file} :: ${needle}`);
}

const html=fs.readFileSync('dashboard.html','utf8');
for (const id of ['chatSelect','targetSelect','testChat','addRun','log','confirmModal']) if(!html.includes(`id="${id}"`)) throw new Error(`dashboard id missing ${id}`);

console.log('STATIC CHECK PASS');
console.log(`files=${required.length}; js_syntax=PASS; manifest=PASS; safety_invariants=${invariants.length}; openai_api_scan=PASS`);
