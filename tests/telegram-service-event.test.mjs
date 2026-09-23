import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isServiceOnlyBusinessMessage } from '../server/supabase/pcs-tg-gateway/service-event.mjs';

const service = { business_message: { message_id: 1, chat: { id: 2 }, message_auto_delete_timer_changed: { message_auto_delete_time: 86400 } } };
assert.equal(isServiceOnlyBusinessMessage(service), true);
for (const content of [
  { text: 'Здравствуйте' },
  { caption: 'Фото автомобиля' },
  { photo: [{ file_id: 'test' }] },
  { voice: { file_id: 'test' } },
  { sticker: { file_id: 'test' } }
]) assert.equal(isServiceOnlyBusinessMessage({ business_message: { ...service.business_message, ...content } }), false);
assert.equal(isServiceOnlyBusinessMessage({ business_message: { text: 'Здравствуйте' } }), false);
assert.equal(isServiceOnlyBusinessMessage({ message: { text: 'Здравствуйте' } }), false);

const gateway = fs.readFileSync(new URL('../server/supabase/pcs-tg-gateway/index.ts', import.meta.url), 'utf8');
assert.ok(gateway.includes('if(isServiceOnlyBusinessMessage(u))'));
assert.ok(gateway.indexOf('if(isServiceOnlyBusinessMessage(u))') < gateway.indexOf('const job=forward(u,expected)'));
console.log('Telegram service event filtering checks passed');
