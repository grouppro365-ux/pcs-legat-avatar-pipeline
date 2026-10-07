import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const itemId='11111111-1111-4111-8111-111111111111';
function adapterHarness({sendResponse,knowledgeResponse,catalogRevision,afterCatalogSave}={}){
  const item={id:itemId,entity_type:'VEHICLE',title:'MG5',city:'Pattaya',
    publication_status:'PUBLISHED',moderation_status:'APPROVED',availability_status:'AVAILABLE',
    client_price_thb:660,deposit_thb:10000,internal_net_thb:520,
    revision:{ui:{description:'Existing description',category:'car_rent',conditions:'Insurance retained',source:'PCS'}}};
  if(catalogRevision!==undefined)item.revision=catalogRevision;
  const calls=[];const media=[{id:'photo-a',public_url:'https://example.test/a.jpg'},{id:'photo-b',public_url:'https://example.test/b.jpg'}];
  const window={fetch:async(url,init={})=>{
    if(new URL(url).pathname.includes('/functions/v1/pcs-kb')){calls.push({knowledge:new URL(url).pathname,params:Object.fromEntries(new URL(url).searchParams),method:init.method,body:init.body,authorization:init.headers?.authorization});return knowledgeResponse?.()||Response.json({rows:[{id:itemId}],page:0});}
    const op=new URL(url).searchParams.get('op');
    const body=init.body?JSON.parse(init.body):null; calls.push({op,body,params:Object.fromEntries(new URL(url).searchParams),view:new URL(url).searchParams.get('view'),authorization:init.headers?.authorization});
    if(op==='delivery-review')return Response.json({ok:true,operator_confirmed:true,review:{id:body.message_id,contact_id:new URL(url).searchParams.get('id')}});
    if(op==='data-quality')return Response.json({rows:[],view:new URL(url).searchParams.get('view'),page:Number(new URL(url).searchParams.get('page'))});
    if(op==='prospecting')return Response.json({rows:[],view:new URL(url).searchParams.get('view')});
    if(op==='prospecting-source-update')return Response.json({ok:true});
    if(op==='prospecting-source')return Response.json({ok:true});
    if(op==='prospecting-scan')return Response.json({ok:true,outreach_sent:0});
    if(op==='finance-balance')return Response.json({reservation_id:new URL(url).searchParams.get('reservation_id')});
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
      afterCatalogSave?.(item);
      return new Response(JSON.stringify({ok:true,id:itemId}));
    }
    return new Response(JSON.stringify({error:'Unexpected operation '+op}),{status:404});
  }};
  vm.runInNewContext(readFileSync(new URL('../neon-adapter.js',import.meta.url),'utf8'),
    {window,URL,Response,localStorage:{pcsToken:'fixture'},console:{error(){}}});
  return {window,item,calls,media};
}

test('quality route forwards filters and the existing admin session',async()=>{
 const h=adapterHarness();const r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/data-quality?view=phone&page=2');
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{rows:[],view:'phone',page:2});assert.equal(h.calls[0].op,'data-quality');assert.equal(h.calls[0].authorization,'Bearer fixture');
});
test('knowledge routes read the existing source and forward current admin session',async()=>{
 const h=adapterHarness();const r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/knowledge?page=2&q=%25_&view=active');assert.equal(r.status,200);assert.equal(h.calls[0].knowledge,'/functions/v1/pcs-kb/list');assert.equal(h.calls[0].params.q,'%_');assert.equal(h.calls[0].params.page,'2');assert.equal(h.calls[0].authorization,'Bearer fixture');
 await h.window.fetch('https://pcs-stable.local/pcs-ui-api/knowledge/'+itemId+'/media');assert.equal(h.calls[1].knowledge,'/functions/v1/pcs-kb/'+itemId+'/media');
});
test('knowledge errors remain errors and invalid write routes do not reach backend',async()=>{
 const h=adapterHarness({knowledgeResponse:()=>Response.json({error:'Unavailable'},{status:503})});const r=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/knowledge');assert.equal(r.status,503);assert.equal((await r.json()).error,'Unavailable');
 const bad=await h.window.fetch('https://pcs-stable.local/pcs-ui-api/knowledge/'+itemId,{method:'DELETE'});assert.equal(bad.status,405);assert.equal(h.calls.length,1);
});
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

test('reservation balance stays in the authenticated canonical PCS source',async()=>{
 const h=adapterHarness(),r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/finance/balance?reservation_id='+itemId);
 assert.equal(r.status,200);assert.equal((await r.json()).reservation_id,itemId);assert.equal(h.calls[0].op,'finance-balance');assert.equal(h.calls[0].authorization,'Bearer fixture');assert.equal(h.calls[0].params.reservation_id,itemId);
});

test('prospecting source edit preserves admin authentication and version payload',async()=>{
 const h=adapterHarness(),body={id:'10000000-0000-4000-8000-000000000001',expected_version:'2026-10-06 15:00:00.123456+00',enabled:false,competitor:true,rules:'Rule'};
 const r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/prospecting/source-update',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal(h.calls[0].op,'prospecting-source-update');assert.equal(h.calls[0].authorization,'Bearer fixture');assert.deepEqual(h.calls[0].body,body);
});
test('prospecting adapter preserves authentication, paging, source payload and scan POST',async()=>{
 const h=adapterHarness();let r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/prospecting?view=sources&page=2&decision=all');assert.equal(r.status,200);assert.equal(h.calls[0].op,'prospecting');assert.equal(h.calls[0].params.page,'2');assert.equal(h.calls[0].authorization,'Bearer fixture');
 r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/prospecting/source',{method:'POST',body:JSON.stringify({username:'@example_source'})});assert.equal(r.status,200);assert.equal(h.calls[1].op,'prospecting-source');assert.equal(h.calls[1].body.username,'@example_source');
 r=await h.window.fetch('https://pcs-stable.local/pcs-ops-api/prospecting/scan',{method:'POST',body:'{}'});assert.equal(r.status,200);assert.equal(h.calls[2].op,'prospecting-scan');assert.equal((await r.json()).outreach_sent,0);
});
test('application workspace routes bind queue filters, identity and exact followup body with admin auth',async()=>{
 const calls=[],window={fetch:async(url,init)=>{calls.push({u:new URL(url),init});return Response.json({ok:true})}};
 vm.runInNewContext(readFileSync(new URL('../neon-adapter.js',import.meta.url),'utf8'),{window,URL,Response,localStorage:{pcsToken:'fixture'},console:{error(){}}});
 await window.fetch('https://pcs-stable.local/pcs-ui-api/application-queue?view=followup&page=2&q=100%25');await window.fetch('https://pcs-stable.local/pcs-ui-api/application-workspace/'+itemId);
 const b={id:itemId,expected_version:'a'.repeat(32),follow_up_at:null,follow_up_note:'Keep'};await window.fetch('https://pcs-stable.local/pcs-ui-api/application-followup',{method:'POST',body:JSON.stringify(b)});
 assert.deepEqual(calls.map(x=>x.u.searchParams.get('op')),['application-queue','application-workspace','application-followup']);assert.equal(calls[0].u.searchParams.get('q'),'100%');assert.equal(calls[0].u.searchParams.get('page'),'2');assert.equal(calls[1].u.searchParams.get('id'),itemId);assert.deepEqual(JSON.parse(calls[2].init.body),b);assert.ok(calls.every(x=>x.init.headers.authorization==='Bearer fixture'));
});
test('application-offer adapter keeps scoped identity, source and page with admin auth',async()=>{
 const calls=[],window={fetch:async(url,init)=>{calls.push({url:new URL(url),init});return Response.json({rows:[]})}};
 vm.runInNewContext(readFileSync(new URL('../neon-adapter.js',import.meta.url),'utf8'),{window,URL,Response,localStorage:{pcsToken:'fixture'},console:{error(){}}});
 await window.fetch('https://pcs-stable.local/pcs-ui-api/application-offers/'+itemId+'?source=quotes&page=2');const r=calls[0];assert.equal(r.url.searchParams.get('op'),'application-offers');assert.equal(r.url.searchParams.get('id'),itemId);assert.equal(r.url.searchParams.get('source'),'quotes');assert.equal(r.url.searchParams.get('page'),'2');assert.equal(r.init.headers.authorization,'Bearer fixture');
});

const savePrice=h=>h.window.fetch('https://pcs-stable.local/pcs-catalog-admin',{method:'POST',body:JSON.stringify({action:'pricing',id:itemId,base_price:750,deposit_thb:12000})});
test('changing catalog price retains the nested canonical description, category, conditions and source',async()=>{
 const h=adapterHarness(),response=await savePrice(h);assert.equal(response.status,200);
 const saved=h.calls.find(x=>x.op==='catalog-save').body;
 assert.deepEqual([saved.description,saved.category,saved.conditions,saved.source],['Existing description','car_rent','Insurance retained','PCS']);
 assert.equal(saved.client_price_thb,750);assert.equal(saved.deposit_thb,12000);assert.equal(saved.internal_net_thb,520);
 assert.equal(h.calls.filter(x=>x.op==='catalog-detail').length,2);
});
test('catalog pricing retains legacy fields separately and respects intentional empty current values',async()=>{
 for(const revision of [{legacy:{description:'Old text',category:'car_rent',conditions:'Old conditions',source:'Owner'}},{ui:{description:''},legacy:{description:'Old text',category:'car_rent',conditions:'Old conditions'},legacy_extra:{source:'Owner'}}]){
  const h=adapterHarness({catalogRevision:revision}),response=await savePrice(h);assert.equal(response.status,200);
  const saved=h.calls.find(x=>x.op==='catalog-save').body;
  assert.equal(saved.description,revision.ui?'':'Old text');assert.equal(saved.category,'car_rent');assert.equal(saved.conditions,'Old conditions');assert.equal(saved.source,'Owner');
 }
});
test('invalid revision text and mismatched item cannot silently overwrite catalog data',async()=>{
 for(const revision of [null,'bad',{ui:{description:{text:'bad'}}},{ui:[]}]){
  const h=adapterHarness({catalogRevision:revision});assert.equal((await savePrice(h)).status,503);assert.ok(!h.calls.some(x=>x.op==='catalog-save'));
 }
 const h=adapterHarness();h.item.id='another';assert.equal((await savePrice(h)).status,503);assert.ok(!h.calls.some(x=>x.op==='catalog-save'));
});
test('catalog pricing reports lost revision fields instead of confirming success',async()=>{
 const h=adapterHarness({afterCatalogSave:item=>{item.revision.ui.conditions='';}});
 const response=await savePrice(h);assert.equal(response.status,503);assert.match((await response.json()).error,/сохранность текста/);
 assert.equal(h.calls.filter(x=>x.op==='catalog-save').length,1);
});
