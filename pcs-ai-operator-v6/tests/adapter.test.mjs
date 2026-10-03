import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const itemId='11111111-1111-4111-8111-111111111111';
function adapterHarness(){
  const item={id:itemId,entity_type:'VEHICLE',title:'MG5',city:'Pattaya',
    publication_status:'PUBLISHED',moderation_status:'APPROVED',availability_status:'AVAILABLE',
    client_price_thb:660,deposit_thb:10000,internal_net_thb:520,
    revision:{ui:{description:'Existing description',category:'car_rent',conditions:'Insurance retained',source:'PCS'}}};
  const calls=[];const media=[{id:'photo-a',public_url:'https://example.test/a.jpg'},{id:'photo-b',public_url:'https://example.test/b.jpg'}];
  const window={fetch:async(url,init={})=>{
    const op=new URL(url).searchParams.get('op');
    const body=init.body?JSON.parse(init.body):null; calls.push({op,body,view:new URL(url).searchParams.get('view'),authorization:init.headers?.authorization});
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
