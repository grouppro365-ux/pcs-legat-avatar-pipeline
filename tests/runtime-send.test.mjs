import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sendRuntimeMessage,runtimeTransport} from '../server/supabase/pcs-manager-live2/runtime-send.mjs';
import {id,fixture} from './runtime-send-fixture.mjs';
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

test('Business Telegram uses grammY, exact business routing and one transport attempt',async()=>{const contact={business_connection_id:'synthetic_business',telegram_chat_id:123456},out={channel:'telegram',text:'Exact approved message'};for(const fail of [false,true]){let sends=0;const transport=async(url,init)=>{if(url.endsWith('pcs_secret_get'))return Response.json('123456:synthetic_token_abcdefghijklmnopqrstuvwxyz');sends++;assert.equal(init.redirect,'error');assert.deepEqual(JSON.parse(init.body),{business_connection_id:contact.business_connection_id,chat_id:'123456',text:out.text});if(fail)throw Error('ambiguous outcome');return Response.json({ok:true,result:{message_id:42}});};if(fail)await assert.rejects(()=>runtimeTransport('https://service.test','key',out,contact,transport));else assert.equal((await runtimeTransport('https://service.test','key',out,contact,transport)).message_id,42);assert.equal(sends,1);}});

test('internal non-Telegram transport preserves approved connection guard and exact recipient',async()=>{const expected='a'.repeat(64);let sent;const out={channel:'instagram',contact_id:id,request_id:id,text:'Exact',expected_connection_fingerprint:expected};await runtimeTransport('https://service.test','key',out,{instagram:'123'},async(url,init)=>{if(url.endsWith('pcs_secret_get'))return Response.json('internal-synthetic');sent=JSON.parse(init.body);return Response.json({ok:true,message_id:id});});assert.equal(sent.expected_recipient,'123');assert.equal(sent.expected_connection_fingerprint,expected);assert.equal(sent.text,'Exact');});
