import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const id='11111111-1111-4111-8111-111111111111';
function harness(){
 const item={id,title:'MG5',media_items:[]},calls=[],sheets=[];
 const nodes={},notices=[];const node=key=>nodes[key]||=( {classList:{toggle(){},add(){},remove(){}},style:{},querySelectorAll:()=>[],addEventListener(){},dataset:{},innerHTML:'',textContent:''});
 const PCS={catalog:[item]};
 const context={PCS,window:{},document:{getElementById:key=>key==='pcsMediaEditor'?(nodes[key]||null):node(key),querySelectorAll:()=>[]},$:node,
  openSheet:(title,body)=>{nodes.pcsMediaEditor={querySelectorAll:()=>[]};sheets.push({title,body})},esc:s=>String(s||''),toast:s=>notices.push(s),confirm:()=>true,
  crypto:{randomUUID:()=>String(calls.length)},URL:{createObjectURL:()=>'/preview',revokeObjectURL(){}},
  FileReader:class{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/';this.onload()}},
  call:async(path,opt={})=>{calls.push({path,opt});if(opt.method==='POST')return opt.body&&path.endsWith('/order')?{ok:true,id,ids:JSON.parse(opt.body).ids}:{ok:true};if(opt.method==='DELETE')return{ok:true,deleted:opt.body&&JSON.parse(opt.body).ids?JSON.parse(opt.body).ids:[path.split('/').pop()]};return [{id:'photo-a',gallery_version:'a'.repeat(32),public_url:'https://example.test/a.jpg'}]},setTimeout(){}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../media.js',import.meta.url),'utf8'),context);
 return {context,item,calls,sheets,nodes,notices};
}
test('photo editor loads real ids and uploads selected files through the authenticated adapter',async()=>{
 const h=harness();await h.context.window.mediaManager(id);
 assert.equal(h.calls[0]?.path,'/catalog/'+id+'/media');
 assert.match(h.sheets[0].body,/photo-a/);
 h.context.addPhotoFiles([{name:'a.jpg',size:123,type:'image/jpeg',lastModified:1}]);
 await h.context.window.uploadPhotoQueue();
 const uploaded=h.calls.find(c=>c.opt.method==='POST');assert.ok(uploaded);
 assert.equal(uploaded.path,'/catalog/'+id+'/media');
 assert.equal(JSON.parse(uploaded.opt.body).content_type,'image/jpeg');
});
test('cover button sends one full gallery order rather than individual unsupported patches',async()=>{
 const h=harness();h.context.call=async(path,opt={})=>{h.calls.push({path,opt});if(opt.method==='POST')return {ok:true,id,ids:JSON.parse(opt.body).ids};return [{id:'photo-a',gallery_version:'a'.repeat(32),public_url:'https://example.test/a.jpg'},{id:'photo-b',public_url:'https://example.test/b.jpg'}]};
 await h.context.window.mediaManager(id);await h.context.window.makeMain(id,'photo-b');
 const ordered=h.calls.find(c=>c.opt.method==='POST');assert.ok(ordered);
 assert.equal(ordered.path,'/catalog/'+id+'/media/order');
 assert.deepEqual(JSON.parse(ordered.opt.body).ids,['photo-b','photo-a']);
});
test('photo selection deletes a batch only after confirmation',async()=>{
 const h=harness();await h.context.window.mediaManager(id);
 assert.match(h.sheets[0].body,/photo-selection/);
 assert.equal(typeof h.context.window.deleteSelectedPhotos,'function');
 h.context.document.querySelectorAll=()=>[{value:'photo-a'}];
 await h.context.window.deleteSelectedPhotos(id);
 const deleted=h.calls.find(c=>c.opt.method==='DELETE');assert.ok(deleted);
 assert.deepEqual(JSON.parse(deleted.opt.body).ids,['photo-a']);
 assert.equal(deleted.path,'/catalog/'+id+'/media');assert.equal(JSON.parse(deleted.opt.body).expected_version,'a'.repeat(32));
});

test('double cover click is blocked while the gallery read is pending',async()=>{
 const h=harness();await h.context.window.mediaManager(id);let resolve;
 h.context.call=(path,opt={})=>{h.calls.push({path,opt});if(opt.method==='POST')return Promise.resolve({ok:true,id,ids:JSON.parse(opt.body).ids});return new Promise(r=>resolve=r)};
 const first=h.context.window.makeMain(id,'photo-a');await h.context.window.makeMain(id,'photo-a');
 assert.equal(h.calls.filter(x=>x.opt.method==='POST').length,0);
 h.nodes.pcsMediaEditor={querySelectorAll:()=>[]};resolve([{id:'photo-a'}]);await first;
 assert.equal(h.calls.filter(x=>x.opt.method==='POST').length,1);assert.equal(h.context.PCS.mediaBusy,false);
});
test('delete preserves a replacement sheet and confirms only the requested photo',async()=>{
 const h=harness();await h.context.window.mediaManager(id);let resolve;
 h.context.call=(path,opt)=>{h.calls.push({path,opt});return new Promise(r=>resolve=r)};
 const first=h.context.window.deletePhoto(id,'photo-a');await h.context.window.deletePhoto(id,'photo-a');
 assert.equal(h.calls.filter(x=>x.opt?.method==='DELETE').length,1);
 h.nodes.pcsMediaEditor={querySelectorAll:()=>[]};resolve({ok:true,deleted:['photo-a']});await first;
 assert.equal(h.sheets.length,1);assert.equal(h.context.PCS.mediaBusy,false);assert.ok(h.notices.includes('Фото удалено'));
});
test('invalid delete receipt does not claim success and releases the controls',async()=>{
 const h=harness();await h.context.window.mediaManager(id);const control={disabled:false};h.nodes.pcsMediaEditor.querySelectorAll=()=>[control];
 h.context.call=async()=>({ok:true,deleted:['another-photo']});await h.context.window.deletePhoto(id,'photo-a');
 assert.equal(control.disabled,false);assert.equal(h.context.PCS.mediaBusy,false);assert.ok(h.notices.some(x=>/не подтвердил/.test(x)));assert.ok(!h.notices.includes('Фото удалено'));
});
test('newer gallery opening wins even when the earlier read finishes last',async()=>{
 const h=harness();let first,second;h.context.call=()=>new Promise(r=>{if(!first)first=r;else second=r});
 const a=h.context.window.mediaManager(id),b=h.context.window.mediaManager(id);
 second([{id:'new'}]);await b;first([{id:'stale'}]);await a;
 assert.equal(h.sheets.length,1);assert.equal(h.item.media_items[0].id,'new');assert.match(h.sheets[0].body,/new/);
});
test('file queue rejects unsupported images and deduplicates one selected batch',async()=>{
 const h=harness();await h.context.window.mediaManager(id);const file={name:'same.jpg',size:123,type:'image/jpeg',lastModified:1};
 h.context.addPhotoFiles([file,file,{...file,name:'a.svg',type:'image/svg+xml'},{...file,name:'a.gif',type:'image/gif'}]);
 assert.equal(h.context.PCS.queue.length,1);assert.equal(h.context.PCS.queue[0].file.name,'same.jpg');assert.match(h.sheets[0].body,/accept="image\/jpeg,image\/png,image\/webp"/);
});

test('completed upload does not reopen the gallery over another sheet',async()=>{
 const h=harness();await h.context.window.mediaManager(id);h.context.addPhotoFiles([{name:'a.jpg',size:123,type:'image/jpeg',lastModified:1}]);let resolve;
 h.context.call=(path,opt={})=>{h.calls.push({path,opt});return opt.method==='POST'?new Promise(r=>resolve=r):Promise.resolve([{id:'photo-a'}])};
 const pending=h.context.window.uploadPhotoQueue();await Promise.resolve();delete h.nodes.pcsMediaEditor;resolve({ok:true});await pending;
 assert.equal(h.sheets.length,1);assert.equal(h.context.PCS.mediaBusy,false);assert.equal(h.context.PCS.queue[0].status,'done');
});

test('busy upload cannot clear, remove or expand its captured queue',async()=>{
 const h=harness();await h.context.window.mediaManager(id);const file={name:'a.jpg',size:123,type:'image/jpeg',lastModified:1};h.context.addPhotoFiles([file]);
 h.context.PCS.mediaBusy=true;h.context.clearPhotoQueue();h.context.removeQueued(h.context.PCS.queue[0].id);h.context.addPhotoFiles([{...file,name:'b.jpg'}]);
 assert.equal(h.context.PCS.queue.length,1);assert.equal(h.context.PCS.queue[0].file.name,'a.jpg');
});

test('cover selection preserves the opened gallery version across a later read',async()=>{
 const h=harness();await h.context.window.mediaManager(id);
 h.context.call=async(path,opt={})=>{h.calls.push({path,opt});if(opt.method==='POST')return {ok:true,id,ids:JSON.parse(opt.body).ids};return [{id:'photo-a',gallery_version:'b'.repeat(32)},{id:'photo-b',gallery_version:'b'.repeat(32)}]};
 await h.context.window.makeMain(id,'photo-b');const call=h.calls.find(x=>x.opt.method==='POST');assert.equal(JSON.parse(call.opt.body).expected_version,'a'.repeat(32));
});
test('incorrect cover receipt never claims success or reloads the editor',async()=>{
 const h=harness();await h.context.window.mediaManager(id);h.context.call=async(path,opt={})=>opt.method==='POST'?{ok:true,id,ids:['photo-a','photo-b']}:[{id:'photo-a'},{id:'photo-b'}];
 await h.context.window.makeMain(id,'photo-b');assert.equal(h.sheets.length,1);assert.equal(h.context.PCS.mediaBusy,false);assert.ok(!h.notices.includes('Обложка изменена'));assert.ok(h.notices.some(x=>/не подтвердил/.test(x)));
});
