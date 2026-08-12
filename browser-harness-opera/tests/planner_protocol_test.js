const assert = require('assert');
const P = require('../planner_protocol.js');

const id='req_live_123';
const valid=`{"requestId":"${id}","status":"act","action":{"type":"click","target":{"ref":"bh12","role":"button","name":"Применить"}},"reason":"go"}`;
assert.equal(P.extractJson(valid,id).action.target.ref,'bh12');

// A nested target object must never be mistaken for the top-level planner response.
const wrapped=`prefix {"ref":"bh99","role":"link"} noise ${valid} suffix`;
assert.equal(P.extractJson(wrapped,id).status,'act');
assert.throws(()=>P.extractJson('{"ref":"bh99","role":"link"}',id),/PLANNER_JSON_NOT_FOUND/);

// Prompt schema uses a placeholder, so the user prompt itself can never validate as the answer.
const schema=P.makeSchemaText();
assert(schema.includes('<REQUEST_ID_FROM_TOP>'));
assert(!schema.includes(id));
assert.throws(()=>P.extractJson(schema,id),/PLANNER_JSON_NOT_FOUND/);

let v=P.validateResponse(P.extractJson(valid,id),id);
assert.equal(v.ok,true);

v=P.validateResponse({requestId:id,status:'act',action:{type:'fill',target:{ref:'bh1'}}},id);
assert.equal(v.ok,false);assert.equal(v.error,'FILL_VALUE_REQUIRED');

v=P.validateResponse({requestId:id,status:'done',result:'x',proof:{kind:'text',includes:'Сохранено'}},id);
assert.equal(v.ok,true);

v=P.validateResponse({requestId:id,status:'done',result:'x',proof:{kind:'text',includes:''}},id);
assert.equal(v.ok,false);

v=P.validateResponse({requestId:'wrong',status:'act',action:{type:'click',target:{ref:'bh1'}}},id);
assert.equal(v.ok,false);assert.equal(v.error,'REQUEST_ID_MISMATCH');

console.log('planner_protocol_test PASS');
