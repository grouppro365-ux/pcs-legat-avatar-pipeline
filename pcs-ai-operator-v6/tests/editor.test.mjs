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
test('runtime scripts have explicit release keys, including the current send modules',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const file of ['app.js','crm-followup.js','crm-message.js','errors.js','delivery-review.js'])assert.ok(html.includes(file+'?v=20261004-delivery-review1'));
 assert.ok(html.includes('approval-review.js?v=20261004-approval1'));
 assert.ok(html.includes('global-search.js?v=20261004-search1'));
 for(const file of ['finance-v26.css','crm-task-queue.js','crm-task-edit.js'])assert.ok(html.includes(file+'?v=20261004-finance-tasks1'));
 assert.ok(html.includes('finance-v26.js?v=20261004-balance1'));
 for(const file of ['neon-adapter.js','router-v26.js','prospecting.js'])assert.ok(html.includes(file+'?v=20261004-prospect2'));
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
  assert.match(html,/knowledge-editor\.js\?v=20260930-kb-media2/, 'fresh cache key required');
});
