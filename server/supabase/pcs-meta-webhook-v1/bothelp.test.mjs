import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBotHelpPayload } from './bothelp.mjs';

test('BotHelp bridge accepts an explicit flow message only', () => {
  const rows = parseBotHelpPayload({
    subscriber_id: 'subscriber-123',
    message_id: 'message-456',
    text: 'Нужна аренда Ford Fiesta',
    name: 'Тестовый клиент',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, 'instagram');
  assert.equal(rows[0].external_user_id, 'subscriber-123');
  assert.equal(rows[0].message_id, 'message-456');
});

test('BotHelp profile or closed-conversation webhook is not a new client message', () => {
  assert.deepEqual(parseBotHelpPayload({event:'user_profile_viewed',user:{id:'123'}}), []);
  assert.deepEqual(parseBotHelpPayload({event:'conversation_closed',user:{id:'123'},messages:[{id:'1',text:'Old message'}]}), []);
});
