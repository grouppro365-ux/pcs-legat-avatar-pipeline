import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=f=>readFileSync(new URL('../pcs-ai-operator-v6/'+f,import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111',row={id,revision:7,title:'Rule',category:'general',description:'Original facts',price:'900719925474099.123456'};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const dom=new JSDOM('<main id="main"></main><div id="sheet"><div id="sheetbox" class="sheetbox"></div></div>',{url:'https://pcs.test',runScripts:'outside-only'}),w=dom.window,calls=[],sheets=[],notices=[];let refreshes=0;
 w.PCS={page:'kb'};w.scrollTo=()=>{};w.__PCS_KB_ROWS__=[row];w.esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.toast=v=>notices.push(v);
 w.call=(path,opt)=>new Promise((resolve,reject)=>calls.push({path,opt,resolve,reject}));w.eval(source('sheet-lifecycle.js'));w.eval(source('navigation-lifecycle.js'));
 w.openSheet=(title,html)=>{w.pcsSheetLifecycle.invalidate();sheets.push(title);w.document.getElementById('sheetbox').innerHTML=html;w.document.getElementById('sheet').classList.add('on');w.document.body.classList.add('sheet-open')};
 w.closeSheet=()=>{w.pcsSheetLifecycle.invalidate();w.document.getElementById('sheet').classList.remove('on');w.document.body.classList.remove('sheet-open')};
 w.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,YQ==';this.onload()}};w.confirm=()=>true;w.eval(source('knowledge-editor.js'));w.kb=async()=>refreshes++;
 return{w,calls,sheets,notices,document:w.document,refreshes:()=>refreshes};
}
async function photos(h,rows=[]){const p=h.w.knowledgePhotos(id);h.calls.at(-1).resolve(rows);await p;}
test('save after close with mounted fields does not reopen knowledge page or allow hidden retry',async()=>{
 const h=fixture();h.w.editKnowledge(id);const p=h.w.saveKnowledge(id);assert.equal(JSON.parse(h.calls[0].opt.body).expected_revision,7);assert.equal(JSON.parse(h.calls[0].opt.body).price,row.price);h.w.closeSheet();h.w.pcsNavigation.run('catalog',()=>{});h.calls[0].resolve({ok:true});await p;assert.equal(h.refreshes(),0);assert.equal(h.w.PCS.page,'catalog');assert.equal(h.notices.length,0);await h.w.saveKnowledge(id);await h.w.knowledgePhotos(id);assert.equal(h.calls.length,1);h.w.close();
});
test('late knowledge conflict does not alter the reopened editor draft',async()=>{
 const h=fixture();h.w.editKnowledge(id);const p=h.w.saveKnowledge(id);h.w.closeSheet();h.calls[0].reject(Object.assign(Error('old conflict'),{status:409}));await p;h.w.editKnowledge(id);h.document.getElementById('kDescription').value='New draft';assert.equal(h.document.getElementById('kSaveError').textContent,'');assert.equal(h.document.getElementById('kDescription').disabled,false);h.w.close();
});
test('deferred photo open cannot replace another sheet, closed retained editor or another route',async()=>{
 for(const transition of ['replace','close','navigate']){const h=fixture();h.w.editKnowledge(id);const p=h.w.knowledgePhotos(id);if(transition==='replace')h.w.openSheet('Other draft','<textarea id="other">unsaved</textarea>');else if(transition==='close')h.w.closeSheet();else h.w.pcsNavigation.run('inbox',()=>{});h.calls[0].resolve([]);await p;assert.equal(h.document.getElementById('knowledgePhotoInput'),null);assert.equal(h.sheets.length,transition==='replace'?2:1);h.w.close();}
});
test('deferred return from media cannot overwrite cached record or reopen after cancellation',async()=>{
 const h=fixture();await photos(h);const p=h.w.knowledgeReturnToRecord(id);h.w.closeSheet();h.calls[1].resolve({...row,revision:8,title:'Stale return'});await p;assert.equal(h.w.__PCS_KB_ROWS__[0].revision,7);assert.equal(h.document.getElementById('kSave'),null);await h.w.knowledgeReturnToRecord(id);assert.equal(h.calls.length,2);h.w.close();
});
test('cancelled upload stops later selected files and cannot reopen media in finally',async()=>{
 const h=fixture();await photos(h);h.w.knowledgePhotoSelect([{name:'one.png',type:'image/png',size:4},{name:'two.png',type:'image/png',size:4}]);const p=h.w.knowledgePhotoUpload();await tick();assert.equal(h.calls[1].opt.method,'POST');h.w.closeSheet();h.calls[1].resolve({id:'saved'});await p;assert.equal(h.calls.length,2);assert.equal(h.sheets.length,1);assert.equal(h.w.PCS.mediaBusy,false);await h.w.knowledgePhotoUpload();h.w.knowledgePhotoSelect([]);assert.equal(h.calls.length,2);h.w.close();
});
test('closing while native photo-delete confirmation is pending prevents deletion and reopening',async()=>{
 const h=fixture();await photos(h,[{id:'photo1',url:'https://pcs.test/photo.png'}]);h.document.querySelector('.knowledge-photo-selection').checked=true;let approve;h.w.Telegram={WebApp:{showConfirm:(text,cb)=>approve=cb}};const p=h.w.knowledgePhotoDelete();h.w.closeSheet();approve(true);await p;assert.equal(h.calls.length,1);assert.equal(h.sheets.length,1);assert.equal(h.w.PCS.mediaBusy,false);h.w.close();
});
test('late photo-delete result cannot discard another editor draft',async()=>{
 const h=fixture();await photos(h,[{id:'photo1',url:'https://pcs.test/photo.png'}]);h.document.querySelector('.knowledge-photo-selection').checked=true;const p=h.w.knowledgePhotoDelete();assert.equal(h.calls[1].opt.method,'DELETE');h.w.openSheet('Other draft','<textarea id="other">unsaved</textarea>');h.calls[1].resolve({ok:true});await p;assert.equal(h.document.getElementById('other').value,'unsaved');assert.equal(h.calls.length,2);assert.equal(h.sheets.length,2);assert.equal(h.w.PCS.mediaBusy,false);h.w.close();
});
test('failed media transition leaves its original editor usable',async()=>{
 const h=fixture();h.w.editKnowledge(id);const p=h.w.knowledgePhotos(id);h.calls[0].reject(Error('media unavailable'));await p;const save=h.w.saveKnowledge(id);assert.equal(h.calls[1].opt.method,'PATCH');h.calls[1].resolve({ok:true});await save;assert.equal(h.refreshes(),1);h.w.close();
});
test('failed return leaves current photo manager able to retry the read',async()=>{
 const h=fixture();await photos(h);const first=h.w.knowledgeReturnToRecord(id);h.calls[1].reject(Error('record unavailable'));await first;const second=h.w.knowledgeReturnToRecord(id);assert.equal(h.calls.length,3);h.calls[2].resolve({...row,revision:8});await second;assert.equal(h.document.getElementById('kTitle').value,'Rule');h.w.close();
});
// JSDOM outside-only leaves inline handlers uncompiled; compile the actual
// shipped attribute in the window realm before dispatching a real DOM click.
function inline(w,node,event='click'){
 node['on'+event]=w.Function('event',node.getAttribute('on'+event));
 return node;
}
test('old inline save and photos buttons cannot borrow a reopened same-record draft',async()=>{
 const h=fixture();h.w.editKnowledge(id);const save=inline(h.w,h.document.getElementById('kSave')),photo=inline(h.w,h.document.getElementById('kPhotos'));h.w.closeSheet();h.w.editKnowledge(id);h.document.getElementById('kDescription').value='New unsaved draft';save.click();photo.click();await tick();assert.equal(h.calls.length,0);assert.equal(h.document.getElementById('kDescription').value,'New unsaved draft');
 const current=inline(h.w,h.document.getElementById('kSave'));current.click();assert.equal(h.calls.length,1);assert.equal(JSON.parse(h.calls[0].opt.body).description,'New unsaved draft');h.calls[0].resolve({ok:true});await tick();h.w.close();
});
test('old inline media upload/delete/return/select controls cannot act on reopened media state',async()=>{
 const h=fixture();await photos(h,[{id:'photo1',url:'https://pcs.test/photo.png'}]);
 const upload=inline(h.w,h.document.getElementById('knowledgePhotoUpload')),del=inline(h.w,h.document.getElementById('knowledgePhotoDelete')),back=inline(h.w,h.document.getElementById('knowledgePhotoReturn')),input=inline(h.w,h.document.getElementById('knowledgePhotoInput'),'change');
 h.w.knowledgePhotoSelect([{name:'old.png',type:'image/png',size:4}]);h.w.closeSheet();await photos(h,[{id:'photo1',url:'https://pcs.test/photo.png'}]);h.w.knowledgePhotoSelect([{name:'new.png',type:'image/png',size:4}]);h.document.querySelector('.knowledge-photo-selection').checked=true;
 upload.click();del.click();back.click();input.dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.calls.length,2);assert.equal(h.document.getElementById('knowledgePhotoQueue').textContent,'new.png');assert.equal(h.document.getElementById('knowledgePhotoUpload').disabled,false);h.w.close();
});
