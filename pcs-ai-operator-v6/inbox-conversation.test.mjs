import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js=readFileSync(new URL('./inbox-v25.js',import.meta.url),'utf8');
const css=readFileSync(new URL('./system-normalizer-v1.css',import.meta.url),'utf8');
const api=readFileSync(new URL('../supabase/functions/pcs-ui-api/index.ts',import.meta.url),'utf8');

assert.match(js,/pcsInboxOpen25/);
assert.match(js,/classList\.add\('detail-open'\)/);
assert.match(js,/pcsInboxBack25/);
assert.match(js,/Текущий запрос/);
assert.match(js,/Ответ для/);
assert.match(js,/Зафиксировать запрос/);
assert.match(js,/pcsInboxConfirmClear25/);
assert.match(js,/method:'DELETE'.*confirm:true/s);
assert.match(css,/\.in25\.detail-open \.in25-chat\{display:grid!important/);
assert.match(api,/async function allMessages/);
assert.match(api,/\.range\(from,from\+999\)/);
assert.match(api,/a\[2\]==='history'.*r\.method==='DELETE'/);
assert.match(api,/body\?\.confirm!==true/);
assert.match(api,/contact_preserved:true,request_preserved:true/);

console.log('inbox conversation workspace regression: ok');
