import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const entry='https://grouppro365-ux.github.io/pcs-legat-avatar-pipeline/?release=20261003-tasks2';
const edge=readFileSync(new URL('../server/supabase/pcs-telegram-set-menu/index.ts',import.meta.url),'utf8');
const gateway=readFileSync(new URL('../server/supabase/pcs-tg-gateway/common.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../pcs-ai-operator-v6/connections-v25.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../pcs-ai-operator-v6/index.html',import.meta.url),'utf8');

assert.ok(edge.includes(`const ENTRY='${entry}'`));
assert.ok(gateway.includes(`export const WEBAPP='${entry}'`));
assert.match(edge,/if\(!await authorized\(req\)\)return json\(req,\{error:'unauthorized'\},401\)/);
assert.ok(edge.indexOf('if(!await authorized(req))')<edge.indexOf('const token=await botToken()'));
assert.match(edge,/menu\?\.web_app\?\.url!==ENTRY/);
assert.match(ui,/authorization:'Bearer '\+token/);
assert.match(ui,/onclick="pcsTelegramMenu25\(\)"/);
assert.match(index,/connections-v25\.js\?v=[A-Za-z0-9-]+/);
assert.ok(edge.includes("'https://grouppro365-ux.github.io'"));
assert.doesNotMatch(edge,/pcs-miniapp-v23|pcs-web-v25/);
console.log('Telegram menu source checks passed');
