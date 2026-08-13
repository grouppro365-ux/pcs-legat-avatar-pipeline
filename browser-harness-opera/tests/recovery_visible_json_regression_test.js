const assert = require('assert');
const planner = require('../planner_protocol.js');

const requestId = 'req_visible_json_regression';
const response = {
  requestId,
  status: 'act',
  action: {
    type: 'fill',
    target: {ref: 'bh136', role: 'textbox', name: 'Article body'},
    value: 'Новый текст статьи'
  },
  progress: {
    itemKey: 'Как тёплые стены и пол от Caleo помогли избавиться от конденсата в ванной',
    itemStatus: 'working',
    note: 'Продолжаю редактирование статьи'
  },
  completionMarker: `ABH_JSON_DONE_${requestId}`
};

const poisonedPrefix = 'старый обрезанный ответ: "строка с { без закрытия ...';
const visibleChatTail = `${poisonedPrefix}\n${JSON.stringify(response)}`;
const parsed = planner.extractJson(visibleChatTail, requestId);

assert.strictEqual(parsed.requestId, requestId);
assert.strictEqual(parsed.status, 'act');
assert.strictEqual(parsed.action.type, 'fill');
assert.strictEqual(parsed.action.value, 'Новый текст статьи');
console.log('PASS recovery_visible_json_regression_test');
