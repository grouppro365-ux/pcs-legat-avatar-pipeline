const assert = require('assert');
const P = require('../planner_protocol.js');

const id='req_live_123';
const valid=`{"requestId":"${id}","status":"act","action":{"type":"click","target":{"ref":"bh12","role":"button","name":"Применить"}},"reason":"go"}`;
assert.equal(P.extractJson(valid,id).action.target.ref,'bh12');

const wrapped=`prefix {"ref":"bh99","role":"link"} noise ${valid} suffix`;
assert.equal(P.extractJson(wrapped,id).status,'act');
assert.throws(()=>P.extractJson('{"ref":"bh99","role":"link"}',id),/PLANNER_JSON_NOT_FOUND/);

const poisoned=`older tail starts mid string \\"foo } } {{ broken text REQUEST_ID=${id} lots of junk ${valid} feedback buttons`;
assert.equal(P.extractJson(poisoned,id).action.target.ref,'bh12');

const duplicated=`REQUEST_ID=${id} schema placeholder text ... assistant: ${valid}`;
assert.equal(P.extractJson(duplicated,id).status,'act');

const schema=P.makeSchemaText('обычная задача');
assert(schema.includes('<REQUEST_ID_FROM_TOP>'));
assert(schema.includes('SMALL LOCAL ACTION BUNDLE'));
assert(!schema.includes(id));
assert.throws(()=>P.extractJson(schema,id),/PLANNER_JSON_NOT_FOUND/);

let v=P.validateResponse(P.extractJson(valid,id),id);
assert.equal(v.ok,true);
assert.equal(v.value.actions.length,1);
assert.equal(v.value.actions[0].target.ref,'bh12');

v=P.validateResponse({requestId:id,status:'act',actions:[
  {type:'fill',target:{ref:'bh1',role:'textbox',name:'Title'},value:'Новый заголовок'},
  {type:'fill',target:{ref:'bh2',role:'textbox',name:'Meta Description'},value:'Описание'},
  {type:'assert',target:{ref:'bh2',role:'textbox',name:'Meta Description'},includes:'Описание'}
]},id);
assert.equal(v.ok,true);
assert.equal(v.value.actions.length,3);

v=P.validateResponse({requestId:id,status:'act',actions:new Array(13).fill(0).map((_,i)=>({type:'click',target:{ref:`bh${i}`}}))},id);
assert.equal(v.ok,false);assert.equal(v.error,'ACTION_BUNDLE_TOO_LARGE');

v=P.validateResponse({requestId:id,status:'act',action:{type:'fill',target:{ref:'bh1'}}},id);
assert.equal(v.ok,false);assert.equal(v.error,'FILL_VALUE_REQUIRED');

v=P.validateResponse({requestId:id,status:'done',result:'x',proof:{kind:'text',includes:'Сохранено'}},id);
assert.equal(v.ok,true);

v=P.validateResponse({requestId:id,status:'done',result:'x',proof:{kind:'text',includes:''}},id);
assert.equal(v.ok,false);

v=P.validateResponse({requestId:'wrong',status:'act',action:{type:'click',target:{ref:'bh1'}}},id);
assert.equal(v.ok,false);assert.equal(v.error,'REQUEST_ID_MISMATCH');

console.log('planner_protocol_test PASS');
