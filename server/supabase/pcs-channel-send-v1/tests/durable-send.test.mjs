import test from 'node:test';
import assert from 'node:assert/strict';
import { durableChannelSend } from '../durable-send.mjs';
function fixture(){
 const tables={pcs_channel_events:[],pcs_messages:[],pcs_tasks:[]};let failure=null,hideRead=false;
 const db={hideReadOnce(){hideRead=true;},fail(f){failure=f;},from(table){let op='select',value,filters=[],one=false;
  const query={select(){return query;},insert(v){op='insert';value=v;return query;},update(v){op='update';value=v;return query;},
   eq(k,v){filters.push(row=>k==='payload->>owner'?row.payload?.owner===v:row[k]===v);return query;},limit(){return query;},single(){one=true;return query;},maybeSingle(){one=true;return query;},
   then(resolve,reject){return Promise.resolve().then(()=>{
    if(failure?.(table,op,value)){failure=null;return {error:{code:'injected_failure'}};}
    if(hideRead&&table==='pcs_channel_events'&&op==='select'){hideRead=false;return {data:null,error:null};}
    let rows=tables[table].filter(row=>filters.every(f=>f(row)));
    if(op==='insert'){
      if(tables[table].some(row=>(table==='pcs_channel_events'&&row.channel===value.channel&&row.external_event_id===value.external_event_id)||(value.id&&row.id===value.id)))return {error:{code:'23505'}};
      const row=structuredClone({id:crypto.randomUUID(),received_at:new Date().toISOString(),...value});tables[table].push(row);rows=[row];
    }
    if(op==='update')rows.forEach(row=>Object.assign(row,structuredClone(value)));
    return {data:structuredClone(one?rows[0]||null:rows),error:null};
   }).then(resolve,reject);}};return query;}};
 const body={channel:'instagram',contact_id:'11111111-1111-4111-8111-111111111111',request_id:'22222222-2222-4222-8222-222222222222',text:'Hello'};
 const args={db,body,target:{id:'123',contact:{name:'Synthetic'}},config:{transport:'meta'}};
 return {db,tables,args};
}
test('successful duplicate command returns original provider receipt without a second send',async()=>{
 const f=fixture();let sends=0;const args={...f.args,send:async()=>({id:'provider-'+(++sends)})};
 const first=await durableChannelSend(args),second=await durableChannelSend(args);
 assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);assert.equal(second.duplicate,true);
 assert.equal(first.message_id,second.message_id);assert.equal(second.external_message_id,'provider-1');
 await assert.rejects(durableChannelSend({...args,body:{...args.body,text:'Changed'}}),/channel_command_changed/);assert.equal(sends,1);
});
test('provider acknowledgement survives history failure and replay repairs history without resending',async()=>{
 const f=fixture();let sends=0;f.db.fail((table,op)=>table==='pcs_messages'&&op==='insert');
 const args={...f.args,send:async()=>({id:'provider-'+(++sends)})};
 await assert.rejects(durableChannelSend(args));assert.equal(f.tables.pcs_channel_events[0].status,'sent');
 const result=await durableChannelSend(args);assert.equal(result.ok,true);assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);
});
test('receipt persistence failure leaves uncertain delivery for review and never repeats provider send',async()=>{
 const f=fixture();let sends=0;
 f.db.fail((table,op,value)=>table==='pcs_channel_events'&&op==='update'&&value.status==='sent');
 const args={...f.args,send:async()=>({id:'provider-'+(++sends)})};
 await assert.rejects(durableChannelSend(args));assert.equal(f.tables.pcs_channel_events[0].status,'delivery_uncertain');
 await assert.rejects(durableChannelSend(args),/channel_delivery_review_required/);
 assert.equal(sends,1);assert.equal(f.tables.pcs_tasks.length,1);assert.equal(f.tables.pcs_messages.length,0);
});
test('concurrent command does not send while its first provider request is in flight',async()=>{
 const f=fixture();let release,start;const started=new Promise(r=>start=r);const blocked=new Promise(r=>release=r);let sends=0;
 const args={...f.args,send:async()=>{sends++;start();await blocked;return {id:'provider-one'};}};
 const first=durableChannelSend(args);await started;
 await assert.rejects(durableChannelSend(args),/message_processing_in_progress/);release();await first;assert.equal(sends,1);
});
test('abandoned sending claim becomes review instead of resending after lease',async()=>{
 const f=fixture();let sends=0;const args={...f.args,send:async()=>({id:'provider-'+(++sends)})};await durableChannelSend(args);
 const event=f.tables.pcs_channel_events[0];event.status='sending';event.payload.claimed_at='2020-01-01T00:00:00Z';delete event.payload.receipt;
 await assert.rejects(durableChannelSend(args),/channel_delivery_review_required/);assert.equal(sends,1);assert.equal(event.status,'delivery_uncertain');
});

test('concurrent completion after initial read cannot acknowledge another command fingerprint',async()=>{
 const f=fixture();let sends=0;const args={...f.args,send:async()=>({id:'provider-'+(++sends)})};
 await durableChannelSend(args);
 // The first command completes after the contender's pre-read: only the final
 // durable receipt can prove which command won the unique-key race.
 f.db.hideReadOnce();
 await assert.rejects(durableChannelSend({...args,body:{...args.body,text:'Different concurrent text'}}),/channel_command_changed/);
 assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);
});
