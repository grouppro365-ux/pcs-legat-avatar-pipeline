import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sendRuntimeMessage} from '../server/supabase/pcs-manager-live2/runtime-send.mjs';
const id='00000000-0000-4000-8000-000000000001';
function fixture(){
 const tables={pcs_contacts:[{id,name:'Test',telegram_chat_id:123,business_connection_id:'test-business'}],pcs_messages:[],pcs_channel_events:[],pcs_tasks:[]};let failHistory=false;
 const db={from(table){let operation='select',values,filters=[],single=false;
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(v){operation='insert';values=v;return q},update(v){operation='update';values=v;return q},then(resolve,reject){return Promise.resolve().then(()=>{
   const matches=x=>filters.every(([k,v])=>k==='payload->>owner'?x.payload?.owner===v:x[k]===v);
   if(operation==='insert'){
    if(table==='pcs_channel_events'&&tables[table].some(x=>x.channel===values.channel&&x.external_event_id===values.external_event_id))return {error:{code:'23505'},data:null};
    if(table==='pcs_messages'&&failHistory){failHistory=false;return {error:Error('history unavailable'),data:null};}
    const row={id:crypto.randomUUID(),...structuredClone(values)};tables[table].push(row);return {data:single?row:[row],error:null};
   }
   const rows=tables[table].filter(matches);if(operation==='update')rows.forEach(x=>Object.assign(x,structuredClone(values)));return {data:single?(rows[0]?structuredClone(rows[0]):null):structuredClone(rows),error:null};
  }).then(resolve,reject)}};return q;}};
 return {db,tables,failHistory(){failHistory=true}};
}
const body=()=>({request_id:crypto.randomUUID(),channel:'telegram',text:'Synthetic test answer'});
test('runtime manual send records once and a duplicate command never sends again',async()=>{
 const f=fixture(),b=body();let sends=0;const transport=async()=>{sends++;return {message_id:1}};
 assert.equal((await sendRuntimeMessage(f.db,id,b,transport)).ok,true);
 assert.equal((await sendRuntimeMessage(f.db,id,b,transport)).duplicate,true);
 assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);assert.equal(f.tables.pcs_messages[0].direction,'out');
 await assert.rejects(sendRuntimeMessage(f.db,id,{...b,text:'Changed'},transport));assert.equal(sends,1);
});
test('a durable provider receipt repairs failed history without another external send',async()=>{
 const f=fixture(),b=body();f.failHistory();let sends=0;const transport=async()=>{sends++;return {message_id:2}};
 await assert.rejects(sendRuntimeMessage(f.db,id,b,transport));assert.equal(f.tables.pcs_channel_events[0].status,'sent');
 await sendRuntimeMessage(f.db,id,b,transport);assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);
});
test('unknown transport outcome is held for review and never blindly resent',async()=>{
 const f=fixture(),b=body();let sends=0;const transport=async()=>{sends++;throw Error('timeout')};
 await assert.rejects(sendRuntimeMessage(f.db,id,b,transport));assert.equal(f.tables.pcs_channel_events[0].status,'delivery_uncertain');assert.equal(f.tables.pcs_tasks.length,1);
 await assert.rejects(sendRuntimeMessage(f.db,id,b,transport));assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,0);
});
test('edge bundle uses exactly the established Conversation Hub delivery state machine',()=>{
 assert.equal(readFileSync(new URL('../server/supabase/pcs-manager-live2/message-processing.mjs',import.meta.url),'utf8'),readFileSync(new URL('../supabase/functions/_shared/message-processing.mjs',import.meta.url),'utf8'));
});
