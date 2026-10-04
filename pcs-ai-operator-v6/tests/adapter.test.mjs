import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const itemId='11111111-1111-4111-8111-111111111111';
function adapterHarness({sendResponse}={}){
  const item={id:itemId,entity_type:'VEHICLE',title:'MG5',city:'Pattaya',
    publication_status:'PUBLISHED',moderation_status:'APPROVED',availability_status:'AVAILABLE',
    client_price_thb:660,deposit_thb:10000,internal_net_thb:520,
    revision:{ui:{description:'Existing description',category:'car_rent',conditions:'Insurance retained',source:'PCS'}}};
  const calls=[];const media=[{id:'photo-a',public_url:'https://example.test/a.jpg'},{id:'photo-b',public_url:'https://example.test/b.jpg'}];
  const window={fetch:async(url,init={})=>{
    const op=new URL(url).searchParams.get('op');
    const body=init.body?JSON.parse(init.body):null; calls.push({op,body,params:Object.fromEntries(new URL(url).searchParams),view:new URL(url).searchParams.get('view'),authorization:init.headers?.authorization});
    if(op==='delivery-review')return Response.json({ok:true,operator_confirmed:true,review:{id:body.message_id,contact_id:new URL(url).searchParams.get('id')}});
    if(op==='finance')return Response.json({source:new URL(url).searchParams.get('source'),rows:[]});
    if(op==='task')return Response.json({task:{id:new URL(url).searchParams.get('task_id'),contact_id:new URL(url).searchParams.get('id')}});
    if(op==='task-update')return Response.json({ok:true,task:{id:body.task_id}});
    if(op==='errors')return Response.json({rows:[],source:new URL(url).searchParams.get('source')});
    if(op==='approval-action')return Response.json({ok:true});
    if(op==='send')return sendResponse?.()||Response.json({ok:true,message_id:123});
    if(op==='tasks')return Response.json({tasks:[{id:'task1',contact_id:'contact1',title:'Task'}],truncated:false});
    if(op==='catalog-detail')return new Response(JSON.stringify({item,media}));
    if(op==='media-add'){media.push({id:'photo-new',public_url:'https://example.test/new.jpg'});return new Response(JSON.stringify({ok:true,id:'photo-new'}));}
    if(op==='media-delete'){const index=media.findIndex(x=>x.id===body.id);if(index>=0)media.splice(index,1);return new Response(JSON.stringify({ok:true}));}
    if(op==='media-order')return new Response(JSON.stringify({ok:true}));
    if(op==='services')return new Response(JSON.stringify([{...item,entity_type:'SERVICE'}]));
    if(op==='catalog-save'){
      Object.assign(item,body);item.revision={ui:{description:body.description,category:body.category,conditions:body.conditions,source:body.source}};
      return new Response(JSON.stringify({ok:true,id:itemId}));
    }
    return new Response(JSON.stringify({error:'Unexpected operation '+op}),{status:404});
  }};
  vm.runInNewContext(readFileSync(new URL('../neon-adapter.js',import.meta.url),'utf8'),
    {window,URL,Response,localStorage:{pcsToken:'fixture'},console:{error(){}}});
  return {window,item,calls,media};
}

test('catalog text edits update the existing id and preserve all commercial terms',async()=>{
  const h=adapterHarness();
  const response=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/catalog/'+itemId,
    {method:'PATCH',body:JSON.stringify({title:'MG5 updated',description:'New description'})});
  assert.equal(response.status,200,'catalog patch should save existing record');
  const save=h.calls.find(x=>x.op==='catalog-save')?.body;
  assert.equal(save?.id,itemId);assert.equal(save.title,'MG5 updated');
  assert.equal(save.client_price_thb,660);assert.equal(save.deposit_thb,10000);
  assert.equal(save.internal_net_thb,520);assert.equal(save.availability_status,'AVAILABLE');
  assert.equal(save.conditions,'Insurance retained');assert.equal(save.source,'PCS');
  assert.equal(h.calls.filter(x=>x.op==='catalog-detail').length,2);
});
test('service entries retain names and customer prices for the existing service editor',async()=>{
 const h=adapterHarness();const response=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/extras');
 assert.equal(response.status,200);const rows=await response.json();
 assert.equal(rows[0].name,'MG5');assert.equal(rows[0].price,660);assert.equal(rows[0].id,itemId);
});
test('batch photo deletion rejects ids belonging to a different record before any delete',async()=>{
 const h=adapterHarness();
 const response=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/catalog/'+itemId+'/media',
   {method:'DELETE',body:JSON.stringify({ids:['photo-a','foreign-photo']})});
 assert.equal(response.status,400);assert.equal(h.calls.filter(c=>c.op==='media-delete').length,0);
 assert.equal(h.media.length,2);
});
test('selecting a cover reorders the existing gallery without removing any photos',async()=>{
 const h=adapterHarness();
 const response=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/catalog/'+itemId+'/media/order',
   {method:'POST',body:JSON.stringify({ids:['photo-b','photo-a']})});
 assert.equal(response.status,200);assert.deepEqual(h.calls.find(c=>c.op==='media-order')?.body.ids,['photo-b','photo-a']);
 assert.equal(h.media.length,2);
});
test('photo routes load the real gallery, add an image and delete only selected ids',async()=>{
 const h=adapterHarness();const url='https://pcs-stable.local/pcs-ui-api/catalog/'+itemId+'/media';
 const gallery=await h.window.fetch(url);assert.equal(gallery.status,200);assert.equal((await gallery.json()).length,2);
 const added=await h.window.fetch(url,{method:'POST',body:JSON.stringify({filename:'new.jpg',content_type:'image/jpeg',content_base64:'/9j/'})});
 assert.equal(added.status,200);assert.equal(h.calls.find(x=>x.op==='media-add').body.item_id,itemId);
 const deleted=await h.window.fetch(url,{method:'DELETE',body:JSON.stringify({ids:['photo-a','photo-new']})});
 assert.equal(deleted.status,200);assert.deepEqual(h.media.map(x=>x.id),['photo-b']);
});

test('task list adapter forwards the selected view and existing admin authentication',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/crm-tasks?view=overdue');
 assert.equal(r.status,200);assert.equal((await r.json()).tasks[0].contact_id,'contact1');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].op,'tasks');assert.equal(h.calls[0].view,'overdue');assert.equal(h.calls[0].authorization,'Bearer fixture');
});
test('task list adapter never turns a POST into a successful read or write',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/crm-tasks',{method:'POST',body:'{}'});
 assert.notEqual(r.status,200);assert.equal(h.calls.length,0);
});

test('reviewed send and follow-up forward the stable request id and bearer token',async()=>{
 for(const action of ['send','followup']){
  const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/crm/contact1/'+action,{method:'POST',body:JSON.stringify({text:'Reviewed',request_id:itemId})});
  assert.equal(r.status,200);assert.equal(h.calls.length,1);assert.equal(h.calls[0].op,'send');
  assert.deepEqual(h.calls[0].body,{text:'Reviewed',request_id:itemId});assert.equal(h.calls[0].authorization,'Bearer fixture');
 }
});
test('uncertain delivery survives the adapter with its status and machine-readable code',async()=>{
 const h=adapterHarness({sendResponse:()=>Response.json({error:'Check dialogue',code:'delivery_uncertain'},{status:409})});
 const r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/crm/contact1/send',{method:'POST',body:JSON.stringify({text:'Reviewed',request_id:itemId})});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'delivery_uncertain');assert.equal(h.calls.length,1);
});

test('approval decisions preserve route identity, reviewed text, version and authentication',async()=>{
 for(const action of ['send','reject']){
  const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/approvals/generation1/'+action,{method:'POST',body:JSON.stringify({expected_version:'microsecond-version',text:'Reviewed',id:'forged',action:'forged'})});
  assert.equal(r.status,200);assert.equal(h.calls.length,1);assert.equal(h.calls[0].op,'approval-action');
  assert.deepEqual(h.calls[0].body,{id:'generation1',action,expected_version:'microsecond-version',...(action==='send'?{text:'Reviewed'}:{})});
  assert.equal(h.calls[0].authorization,'Bearer fixture');
 }
});
test('approval read methods cannot trigger a decision',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/approvals/generation1/send');
 assert.equal(r.status,405);assert.equal(h.calls.length,0);
});

test('error queues preserve source, page and current admin authentication',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-errors-api?source=delivery&page=2');
 assert.equal(r.status,200);assert.equal((await r.json()).source,'delivery');assert.equal(h.calls[0].op,'errors');assert.equal(h.calls[0].authorization,'Bearer fixture');
});

test('finance adapter forwards source, status and page through the authenticated manager',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/finance?source=quotes&status=all&page=4');assert.equal(r.status,200);assert.equal((await r.json()).source,'quotes');assert.deepEqual(h.calls[0].params,{op:'finance',source:'quotes',status:'all',page:'4'});assert.equal(h.calls[0].authorization,'Bearer fixture');
});
test('task adapter binds route identity and rejects forged task id before a write',async()=>{
 const h=adapterHarness(),url='https://pcs-stable.local/pcs-ui-api/crm/contact1/tasks/task1';const read=await h.window.fetch(url);assert.equal((await read.json()).task.id,'task1');
 const bad=await h.window.fetch(url,{method:'PATCH',body:JSON.stringify({task_id:'other',title:'X'})});assert.equal(bad.status,400);assert.equal(h.calls.filter(x=>x.op==='task-update').length,0);
 const ok=await h.window.fetch(url,{method:'PATCH',body:JSON.stringify({expected_version:'version',title:'X'})});assert.equal(ok.status,200);assert.equal(h.calls.at(-1).body.task_id,'task1');assert.equal(h.calls.at(-1).params.id,'contact1');
});

test('manual delivery review adapter uses the existing admin manager and bound client identity',async()=>{
 const h=adapterHarness(),body={message_id:'11111111-1111-4111-8111-111111111111',expected_version:'exact',confirmed:true,note:'Checked conversation'};const r=await h.window.fetch('https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-errors-api/delivery/contact1/confirm',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).operator_confirmed,true);assert.equal(h.calls[0].op,'delivery-review');assert.equal(h.calls[0].params.id,'contact1');assert.deepEqual(h.calls[0].body,body);assert.equal(h.calls[0].authorization,'Bearer fixture');
});
