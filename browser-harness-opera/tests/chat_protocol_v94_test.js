const assert = require('assert');
const planner = require('../planner_protocol.js');
const chat = require('../chat_protocol_v94.js');

const requestId = 'req_live_case';
const marker = 'ABH_JSON_DONE_req_live_case';
const valid = JSON.stringify({requestId,status:'act',completionMarker:marker,action:{type:'click',target:{role:'link',name:'Next'}}});
const turns = [
  {role:'user',text:`REQUEST_ID=${requestId}`},
  {role:'assistant',text:'Thinking'},
  {role:'assistant',text:valid}
];
const fragments = chat.assistantFragmentsAfterRequest(turns, requestId);
assert.deepEqual(fragments, ['Thinking', valid]);
assert(chat.parseAssistantFragments(fragments, requestId, marker, planner.extractJson, true));

const rawText = 'Bathroom says "hello".\nSecond paragraph.';
const control = JSON.stringify({requestId,status:'act',completionMarker:marker,action:{type:'fill',target:{ref:'bh136'},textBlockId:'BODY'}});
const response = control + '\n<<<ABH_TEXT:BODY>>>\n' + rawText + '\n<<<ABH_END_TEXT:BODY>>>';
const hydrated = chat.parseAssistantFragments([response], requestId, marker, planner.extractJson, true);
assert(hydrated && hydrated.action.value === rawText);

const q = String.fromCharCode(34);
const malformed = '{'+q+'requestId'+q+':'+q+requestId+q+','+q+'status'+q+':'+q+'act'+q+','+q+'action'+q+':{'+q+'type'+q+':'+q+'fill'+q+','+q+'target'+q+':{'+q+'ref'+q+':'+q+'bh136'+q+'},'+q+'value'+q+':'+q+'Text '+q+'quoted'+q+' text.'+q+'},'+q+'completionMarker'+q+':'+q+marker+q+'}';
assert.throws(() => JSON.parse(malformed));
const recovered = chat.parseAssistantFragments([malformed], requestId, marker, planner.extractJson, true);
assert(recovered && recovered.action.value.includes('quoted'));
assert.equal(recovered.action.target.ref, 'bh136');
console.log('chat_protocol_v94_test PASS');
