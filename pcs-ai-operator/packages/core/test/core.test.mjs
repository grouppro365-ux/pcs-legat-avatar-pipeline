import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, normalizeTelegramUpdate, decidePolicy, parseAiCandidate, retryDelayMs } from '../dist/index.js';

test('classifies Russian car rental', () => {
  assert.equal(classifyIntent('Здравствуйте. Нужна машина в аренду в Паттайе с 5 по 15 сентября'), 'car_rent');
});

test('normalizes business_message', () => {
  const n = normalizeTelegramUpdate({ update_id: 77, business_message: { message_id: 5, business_connection_id: 'bc-1', chat: { id: 100 }, from: { id: 200 }, text: 'hello' } });
  assert.equal(n.kind, 'business_message');
  assert.equal(n.businessConnectionId, 'bc-1');
  assert.equal(n.chatId, 100);
  assert.equal(n.text, 'hello');
});

test('global auto off means approval', () => {
  const r = decidePolicy({ globalAutoSend: false, minimumConfidence: .9, candidate: { intent: 'car_rent', confidence: .97, risk: 'low', requires_human: false, answer: 'Уточните даты.' } });
  assert.equal(r.decision, 'approval');
});

test('financial claim without knowledge source is human', () => {
  const r = decidePolicy({ globalAutoSend: true, minimumConfidence: .9, candidate: { intent: 'car_rent', confidence: .98, risk: 'low', requires_human: false, answer: 'Стоимость 12 000 THB.' } });
  assert.equal(r.decision, 'human');
});

test('complaint never auto sends', () => {
  const r = decidePolicy({ globalAutoSend: true, minimumConfidence: .5, candidate: { intent: 'complaint', confidence: .99, risk: 'low', requires_human: false, answer: 'Ответ' } });
  assert.equal(r.decision, 'human');
});

test('validates structured AI output', () => {
  const p = parseAiCandidate(JSON.stringify({ intent:'car_rent', confidence:.96, risk:'low', requires_human:false, answer:'Уточните бюджет.', next_action:'qualify', crm_updates:{} }));
  assert.equal(p.intent, 'car_rent');
});

test('rejects broken JSON', () => {
  assert.throws(() => parseAiCandidate('{broken'), /valid JSON/);
});

test('uses the specified retry schedule', () => {
  assert.deepEqual([1,2,3,4].map(retryDelayMs), [5000,30000,120000,600000]);
});
