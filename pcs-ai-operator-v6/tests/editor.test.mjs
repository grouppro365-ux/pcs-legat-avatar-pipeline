import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function knowledgeHarness(rows=[],overrides={}) {
  const sheets=[]; const notices=[];
  const window={__PCS_KB_ROWS__:rows};
  const context={window,document:{},esc:value=>String(value??''),
    openSheet:(title,html)=>sheets.push({title,html}),toast:value=>notices.push(value),...overrides};
  vm.runInNewContext(readFileSync(new URL('../knowledge-editor.js',import.meta.url),'utf8'),context);
  return {window,sheets,notices};
}

test('edit opens the selected v26 knowledge record with its existing values',()=>{
  const entry={id:'kb-existing',title:'Ford Focus',description:'400 THB daily',category:'car_rent'};
  const h=knowledgeHarness([entry]);
  h.window.editKnowledge(entry.id);
  assert.equal(h.sheets[0]?.title,'Редактировать запись');
  assert.match(h.sheets[0].html,/value="Ford Focus"/);
  assert.match(h.sheets[0].html,/400 THB daily/);
  assert.match(h.sheets[0].html,/saveKnowledge\('kb-existing'\)/);
});
test('knowledge edit preserves exact price and captured revision on conflict',async()=>{
 const row={id:'11111111-1111-4111-8111-111111111111',revision:7,title:'Rule',category:'car_rent',description:'Terms',status:'outdated',visibility:'customer_safe'},nodes={},calls=[];let closed=0;
 for(const [id,value] of Object.entries({kTitle:'Rule',kCategory:'car_rent',kDescription:'Terms',kValid:'',kCity:'',kVisibility:'customer_safe',kStatus:'outdated',kPrice:'900719925474099.123456',kCurrency:'THB',kSource:'',kConditions:'',kRestrictions:'',kGuidance:'',kComment:''}))nodes[id]={value};nodes.kAuto={checked:false};nodes.kSaveError={textContent:''};nodes.kSave={disabled:false};
 const h=knowledgeHarness([row],{document:{querySelector:q=>nodes[q.slice(1)]},call:async(p,o)=>{calls.push(JSON.parse(o.body));const e=Error('Запись изменилась');e.status=409;throw e},closeSheet:()=>closed++,kb:async()=>{}});h.window.editKnowledge(row.id);await h.window.saveKnowledge(row.id);
 assert.equal(calls[0].expected_revision,7);assert.equal(calls[0].price,'900719925474099.123456');assert.equal(calls[0].status,'outdated');assert.equal(closed,0);assert.equal(nodes.kDescription.value,'Terms');assert.equal(nodes.kSave.disabled,false);assert.match(nodes.kSaveError.textContent,/изменилась/);
});
test('new knowledge retries the same creation id and body after an uncertain response',async()=>{
 const nodes={},calls=[];for(const [id,value]of Object.entries({kTitle:'Rule',kCategory:'general',kDescription:'Original',kValid:'',kCity:'',kVisibility:'approval_only',kStatus:'draft',kPrice:'',kCurrency:'',kSource:'',kConditions:'',kRestrictions:'',kGuidance:'',kComment:''}))nodes[id]={value};nodes.kAuto={checked:false};nodes.kSaveError={textContent:''};nodes.kSave={disabled:false};
 const h=knowledgeHarness([],{crypto,document:{querySelector:q=>nodes[q.slice(1)]},call:async(p,o)=>{calls.push(o.body);throw Error('Timeout')},closeSheet(){},kb:async()=>{}});h.window.editKnowledge();await h.window.saveKnowledge('');nodes.kDescription.value='Changed after timeout';await h.window.saveKnowledge('');assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);assert.match(JSON.parse(calls[0]).id,/^[0-9a-f-]{36}$/);assert.match(nodes.kSaveError.textContent,/это же сохранение/);
});
test('pending knowledge save freezes fields and does not close a replacement sheet',async()=>{
 const row={id:'11111111-1111-4111-8111-111111111111',revision:1},nodes={};for(const [id,value]of Object.entries({kTitle:'Rule',kCategory:'general',kDescription:'Terms',kValid:'',kCity:'',kVisibility:'approval_only',kStatus:'draft',kPrice:'',kCurrency:'',kSource:'',kConditions:'',kRestrictions:'',kGuidance:'',kComment:''}))nodes[id]={value};nodes.kAuto={checked:false};nodes.kSaveError={textContent:''};nodes.kSave={disabled:false};let resolve,closed=0,refresh=0;const field={disabled:false};const h=knowledgeHarness([row],{document:{querySelector:q=>nodes[q.slice(1)],querySelectorAll:()=>[field]},call:()=>new Promise(r=>resolve=r),closeSheet:()=>closed++,kb:async()=>refresh++});h.window.editKnowledge(row.id);const pending=h.window.saveKnowledge(row.id);assert.equal(field.disabled,true);nodes.kSave={disabled:false};resolve({});await pending;assert.equal(field.disabled,false);assert.equal(closed,0);assert.equal(refresh,0);
});
test('runtime scripts have explicit release keys, including the current send modules',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const file of ['crm-followup.js','crm-message.js','errors.js','delivery-review.js'])assert.ok(html.includes(file+'?v=20261004-delivery-review1'));
 for(const file of ['app.js','data-quality.js'])assert.ok(html.includes(file+'?v=20261006-quality1'));
 assert.ok(html.includes('approval-review.js?v=20261004-approval1'));
 assert.ok(html.includes('global-search.js?v=20261006-search2'));
 for(const file of ['finance-v26.css','crm-task-queue.js','crm-task-edit.js'])assert.ok(html.includes(file+'?v=20261004-finance-tasks1'));
 assert.ok(html.includes('finance-v26.js?v=20261004-balance1'));
 assert.ok(html.includes('router-v26.js?v=20261004-prospect2'));
 assert.ok(html.includes('prospecting.js?v=20261006-source1'));
 assert.ok(html.includes('neon-adapter.js?v=20261008-photo2'));
 assert.ok(html.includes('dashboard-v25.js?v=20261005-due2'));
 assert.ok(html.includes('notifications.js?v=20261005-operations2'));
 for(const file of ['operator-ux-v37.js','media.js'])assert.match(html,new RegExp(file.replaceAll('.','\\.')+'\\?v=\\d{8}-[a-z0-9-]+'));
});

test('unknown record never silently opens a creation form',()=>{
  const h=knowledgeHarness([{id:'existing',title:'Existing'}]);
  h.window.editKnowledge('missing-record');
  assert.equal(h.sheets.length,0,'unknown record must not open creation form');
  assert.equal(h.notices.length,1);
});

test('existing knowledge entry exposes its own photo manager inside Mini App',()=>{
  const h=knowledgeHarness([{id:'kb-photo',title:'Existing'}]);
  h.window.editKnowledge('kb-photo');
  assert.match(h.sheets[0].html,/knowledgePhotos\('kb-photo'\)/);
});

test('Mini App uploads the selected knowledge photo batch sequentially to the existing entry',async()=>{
  const calls=[];let active=0,peak=0;
  const button={disabled:false},queue={textContent:''};
  const h=knowledgeHarness([{id:'kb-photo',title:'Existing'}],{
    PCS:{},document:{querySelector:selector=>selector==='#knowledgePhotoUpload'?button:queue},
    FileReader:class {readAsDataURL(file){this.result='data:image/png;base64,'+file.name;this.onload()}},
    call:async(path,options={})=>{calls.push({path,options});if(options.method==='POST'){active++;peak=Math.max(peak,active);await Promise.resolve();active--;return {id:'saved'}}return []}
  });
  assert.equal(typeof h.window.knowledgePhotos,'function');
  await h.window.knowledgePhotos('kb-photo');
  assert.match(h.sheets.at(-1).html,/type="file"[^>]*multiple/);
  h.window.knowledgePhotoSelect([{name:'a',type:'image/png',size:4},{name:'b',type:'image/png',size:4}]);
  await h.window.knowledgePhotoUpload();
  const uploads=calls.filter(x=>x.options.method==='POST');
  assert.equal(uploads.length,2);
  assert.equal(peak,1);
  assert.ok(uploads.every(x=>x.path==='/knowledge/kb-photo/media'));
  assert.equal(button.disabled,true,'no pending files remain to upload');
});

test('Mini App deletes selected knowledge photos only after confirmation',async()=>{
  const calls=[];let approved=false;
  const h=knowledgeHarness([{id:'kb-photo',title:'Existing'}],{PCS:{},confirm:()=>approved,document:{querySelectorAll:()=>[{value:'photo-a'},{value:'photo-b'}]},call:async(path,options={})=>{calls.push({path,options});return []}});
  await h.window.knowledgePhotos('kb-photo');
  assert.equal(typeof h.window.knowledgePhotoDelete,'function');
  await h.window.knowledgePhotoDelete();
  assert.equal(calls.filter(x=>x.options.method==='DELETE').length,0);
  approved=true;await h.window.knowledgePhotoDelete();
  const deleted=calls.find(x=>x.options.method==='DELETE');
  assert.equal(deleted.path,'/knowledge/kb-photo/media');
  assert.deepEqual(JSON.parse(deleted.options.body),{ids:['photo-a','photo-b']});
});

test('mini app uses a fresh cache key for the repaired editor',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/knowledge-editor\.js\?v=20261006-knowledge1/, 'fresh cache key required');
});
