const assert = require('assert');
const planner = require('../planner_protocol.js');
const chat = require('../chat_protocol_v94.js');

const requestId = 'req_live_timeout_case';
const marker = 'ABH_JSON_DONE_req_live_timeout_case';
const valid = JSON.stringify({
  requestId,
  status:'act',
  completionMarker:marker,
  action:{type:'click',target:{role:'link',name:'Следующая страница'}}
});

const turns = [
  {role:'user',text:'старый запрос'},
  {role:'assistant',text:'старый ответ'},
  {role:'user',text:`REQUEST_ID=${requestId}\nTRANSPORT_COMPLETION_MARKER=${marker}`},
  {role:'assistant',text:'Thinking…'},
  {role:'assistant',text:valid},
  {role:'user',text:'следующий пользовательский запрос'},
  {role:'assistant',text:'не относится к предыдущему запросу'}
];

assert.equal(chat.requestTurnIndex(turns, requestId), 2);
const fragments = chat.assistantFragmentsAfterRequest(turns, requestId);
assert.deepEqual(fragments, ['Thinking…', valid]);
const parsed = chat.parseAssistantFragments(fragments, requestId, marker, planner.extractJson, true);
assert(parsed, 'final JSON after transient assistant fragment must be recovered');
assert.equal(parsed.requestId, requestId);
assert.equal(parsed.action.type, 'click');

// Marker only in the user prompt must never count as assistant completion.
assert.equal(chat.parseAssistantFragments(['Thinking…'], requestId, marker, planner.extractJson, true), null);

// Valid JSON without marker is not accepted in normal completion mode, but can be final-recovery evidence.
const noMarker = JSON.stringify({requestId,status:'act',action:{type:'click',target:{role:'button',name:'OK'}}});
assert.equal(chat.parseAssistantFragments([noMarker], requestId, marker, planner.extractJson, true), null);
const recovered = chat.parseAssistantFragments([noMarker], requestId, marker, planner.extractJson, false);
assert(recovered && recovered.requestId === requestId);

// A later user turn terminates the assistant-fragment window.
assert(!fragments.some(x => x.includes('не относится')));

console.log('chat_protocol_v94_test PASS');
