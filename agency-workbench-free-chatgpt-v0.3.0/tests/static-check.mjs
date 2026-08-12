import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const background = read('background.js');
const chat = read('chatgpt-bridge.js');
const page = read('page-agent.js');
const dash = read('dashboard.js');
const html = read('dashboard.html');
const all = [JSON.stringify(manifest), background, chat, page, dash, html].join('\n');

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: !!ok });
  if (!ok) process.exitCode = 1;
}

check('MV3 manifest', manifest.manifest_version === 3);
check('scripting permission', manifest.permissions?.includes('scripting'));
check('host permissions', manifest.host_permissions?.includes('https://*/*'));
check('self-injection uses chrome.scripting.executeScript', background.includes('chrome.scripting.executeScript'));
check('chat ping before/after injection', background.includes('AGENCY_CHAT_PING') && chat.includes('AGENCY_CHAT_PING'));
check('page ping before/after injection', background.includes('AGENCY_PAGE_PING') && page.includes('AGENCY_PAGE_PING'));
check('visible diagnosis UI', html.includes('Проверить bridge') && html.includes('Тест ChatGPT'));
check('execution log exists', html.includes('Журнал выполнения') && dash.includes('Команда разобрана'));
check('request binding', dash.includes('requestId') && background.includes('requestId'));
check('dangerous action confirmation', page.includes('confirmationRequired') && dash.includes('confirmPending'));
check('cross-origin block', page.includes('u.origin !== location.origin'));
check('no OpenAI API endpoint', !/api\.openai\.com|OPENAI_API_KEY/i.test(all));
check('step limit', dash.includes('step <= 24'));

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
if (process.exitCode) throw new Error('Static checks failed');
console.log(`ALL ${checks.length} STATIC CHECKS PASS`);