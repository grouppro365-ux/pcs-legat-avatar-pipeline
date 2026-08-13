const assert=require('assert');
const planner=require('../planner_protocol.js');
const chat=require('../chat_protocol_v94.js');

const requestId='wire:req_live_case';
const marker='ABH_JSON_DONE_wire_req_live_case';
const valid=JSON.stringify({requestId,status:'act',completionMarker:marker,action:{type:'click',target:{role:'link',name:'Next'}}});
const turns=[{role:'user',text:'REQUEST_ID='+requestId},{role:'assistant',text:'Thinking'},{role:'assistant',text:valid}];
const fragments=chat.assistantFragmentsAfterRequest(turns,requestId);
assert.deepEqual(fragments,['Thinking',valid]);
assert(chat.parseAssistantFragments(fragments,requestId,marker,planner.extractJson,true));

const rawText='First line with quotes.\nSecond line.';
const control=JSON.stringify({requestId,status:'act',completionMarker:marker,action:{type:'fill',target:{ref:'bh136'},textBlockId:'BODY'}});
const response=control+'\n<<<ABH_TEXT:BODY>>>\n'+rawText+'\n<<<ABH_END_TEXT:BODY>>>';
const hydrated=chat.parseAssistantFragments([response],requestId,marker,planner.extractJson,true);
assert(hydrated);
assert.equal(hydrated.action.type,'fill');
assert.equal(hydrated.action.target.ref,'bh136');
assert.equal(hydrated.action.value,rawText);

const fallbackProbe=JSON.stringify({requestId,status:'act',action:{type:'fill',target:{ref:'bh136'},value:'Recovered body text'},completionMarker:marker});
const recovered=chat.recoverMalformedFill(fallbackProbe,requestId);
assert(recovered);
assert.equal(recovered.requestId,requestId);
assert.equal(recovered.action.target.ref,'bh136');
assert(recovered.action.value.includes('Recovered body text'));
console.log('chat_protocol_v94_test PASS');
