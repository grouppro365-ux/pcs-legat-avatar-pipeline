import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
import * as policy from './channel-policy.mjs';
import * as recovery from './inbound-recovery.mjs';
const rawSource=await readFile(new URL('./index.ts',import.meta.url),'utf8');
const compileSource=input=>stripTypeScriptTypes(input.replace(/^import .*;\r?\n/gm,''));
const source=compileSource(rawSource);
function harness(){
 const contact={id:'11111111-1111-4111-8111-111111111111',intent:'other'},messageId='22222222-2222-4222-8222-222222222222';
 const tables={pcs_contacts:[contact],pcs_messages:[{id:messageId,contact_id:contact.id,channel:'instagram',external_message_id:'external-one',direction:'in'}],
  pcs_channel_connections:[{channel:'instagram',enabled:true,status:'active',public_config:{transport:'bothelp',reply_mode:'auto'}}],
  pcs_settings:[{id:'main',auto_send:true}],pcs_ai_generations:[]};
 let failStatus=false;const requests=[],receipts=new Map();
 const db={from(table){let op='select',input,filters=[],one=false,ignore=false;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},order(){return q;},limit(){return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},
    upsert(v,options){op='upsert';input=v;ignore=options.ignoreDuplicates;return q;},update(v){op='update';input=v;return q;},
    then(resolve,reject){return Promise.resolve().then(()=>{
      if(table==='pcs_ai_generations'&&op==='update'&&input.status==='sent'&&failStatus){failStatus=false;return {error:new Error('history-write-failed')};}
      let rows=tables[table].filter(r=>filters.every(f=>f(r)));
      if(op==='upsert'){
       const existing=tables[table].find(r=>r.id===input.id);if(!existing){const r={created_at:new Date().toISOString(),...structuredClone(input)};tables[table].push(r);rows=[r];}else rows=ignore?[]:[existing];
      }
      if(op==='update')rows.forEach(r=>Object.assign(r,structuredClone(input)));
      return {data:structuredClone(one?rows[0]||null:rows),error:null};
    }).then(resolve,reject);}};return q;}};
 const context=vm.createContext({createClient:()=>db,Deno:{env:{get:()=> 'https://synthetic.test'},serve(){}},console,crypto,TextEncoder,TextDecoder,URL,Response,Headers,AbortSignal,setTimeout,clearTimeout,...policy,...recovery,
  fetch:async(url,init)=>{const out=JSON.parse(init.body);requests.push(out);if(!receipts.has(out.request_id))receipts.set(out.request_id,{ok:true,message_id:'history-one',external_message_id:'provider-one'});return {ok:true,json:async()=>receipts.get(out.request_id)};}});
 vm.runInContext(source,context);
 vm.runInContext(`
 let ingested=false;
 ingest=async()=>{if(ingested)return null;ingested=true;return {messageId:'${messageId}',contact:${JSON.stringify(contact)},language:'en'};};
 structuredCarRentalSelection=async()=>null;
 structuredCarRentalReply=async()=>({answer:'Hello',provider:'deterministic',model:'social-greeting',confidence:1,knowledgeIds:[],autoSend:true});
 humanRisk=()=>null;languageForMessage=()=> 'en';secret=async()=> 'synthetic-secret';
 createTask=async()=>{};setConversationState=async()=>{};
 `,context);
 const row={message_id:'external-one',external_user_id:'bothelp:1',text:'hello',kind:'text'};
 return {tables,requests,receipts,failMark(){failStatus=true;},run:()=>context.processInbound('instagram',row)};
}
test('replayed ingress after generation status persistence failure resumes same durable send command',async()=>{
 const h=harness();h.failMark();await assert.rejects(h.run(),/history-write-failed/);
 assert.equal(h.tables.pcs_ai_generations.length,1);assert.equal(h.tables.pcs_ai_generations[0].status,'failed');
 const result=await h.run();assert.equal(result.action,'sent');assert.equal(h.tables.pcs_ai_generations.length,1);
 assert.equal(h.requests.length,2);assert.equal(h.requests[0].request_id,h.requests[1].request_id);assert.equal(h.receipts.size,1);
 const duplicate=await h.run();assert.equal(duplicate.duplicate,true);assert.equal(h.requests.length,2);
});
test('changed current global policy holds existing recoverable generation for operator without dispatch',async()=>{
 const h=harness();h.failMark();await assert.rejects(h.run());h.tables.pcs_settings[0].auto_send=false;
 assert.equal((await h.run()).action,'approval_required');assert.equal(h.requests.length,1);
 assert.equal(h.tables.pcs_ai_generations[0].requires_human,true);
});

test('transport harness accepts Windows CRLF source without leftover static imports',()=>{assert.doesNotThrow(()=>new vm.Script(compileSource(rawSource.replace(/\r?\n/g,'\r\n'))));});
