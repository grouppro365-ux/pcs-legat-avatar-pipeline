import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read=name=>readFileSync(new URL('../pcs-ai-operator-v6/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const photo={id:'photo',gallery_item_version:'version',gallery_version:'gallery',public_url:'https://example.invalid/photo.jpg'};
const file={name:'photo.jpg',type:'image/jpeg',size:123,lastModified:1};
function fixture(){
 let main={},nodes={},transport;const requests=[],sheets=[],notices=[];
 const node=()=>({querySelectorAll:()=>[],classList:{toggle(){},add(){},remove(){}},style:{},dataset:{},addEventListener(){},innerHTML:'',textContent:'',disabled:false});
 const get=id=>nodes[id]||=(node());
 const PCS={page:'catalog',catalog:[{id:'first',title:'First',media_items:[]},{id:'second',title:'Second',media_items:[]}],queue:[]},window={PCS};
 const document={getElementById:id=>id==='main'?main:nodes[id]||null,querySelectorAll:()=>[]};
 const context={window,PCS,document,$:selector=>get(selector.replace(/^#/,'')),esc:String,toast:m=>notices.push(m),confirm:()=>true,crypto:{randomUUID},URL:{createObjectURL:()=>'/preview',revokeObjectURL(){}},setTimeout(){},FileReader:class{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/';this.onload();}},openSheet(title,body){window.pcsSheetLifecycle.invalidate();nodes={pcsMediaEditor:node()};sheets.push({title,body});},call:async(path,opt={})=>{requests.push({path,opt});if(transport)return await transport(path,opt);return opt.method==='POST'?{ok:true,id:JSON.parse(opt.body).request_id}:opt.method==='DELETE'?{ok:true,deleted:['photo']}:[photo];}};
 vm.createContext(context);vm.runInContext(read('sheet-lifecycle.js'),context);vm.runInContext(read('media.js'),context);
 return{context,window,requests,sheets,notices,get nodes(){return nodes;},transport:fn=>transport=fn,close(){window.pcsSheetLifecycle.invalidate();PCS.queue=[];},navigate(){PCS.page='crm';main={};},otherSheet(){context.openSheet('Another sheet','');delete nodes.pcsMediaEditor;}};
}
test('deferred gallery reads cannot reopen after close, navigation or another sheet intent',async()=>{
 for(const action of ['close','navigate','otherSheet']){
  const f=fixture(),read=deferred();f.transport(()=>read.promise);const opening=f.window.mediaManager('first');f[action]();const count=f.sheets.length;read.resolve([photo]);await opening;
  assert.equal(f.sheets.length,count,action);assert.equal(f.context.PCS.catalog[0].media_items.length,0,action);
 }
});
test('a delayed failed gallery read does not toast into a later page',async()=>{
 const f=fixture(),read=deferred();f.transport(()=>read.promise);const opening=f.window.mediaManager('first');f.navigate();read.reject(Error('Old gallery failure'));await opening;assert.deepEqual(f.notices,[]);
});
test('confirmed deletion finishing after close leaves the mounted closed gallery intact',async()=>{
 const f=fixture();await f.window.mediaManager('first');const root=f.nodes.pcsMediaEditor,write=deferred();f.transport(()=>write.promise);const deleting=f.window.deletePhoto('first','photo');f.close();write.resolve({ok:true,deleted:['photo']});await deleting;
 assert.equal(f.nodes.pcsMediaEditor,root);assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);assert.equal(f.context.PCS.mediaBusy,false);
});
test('gallery refresh started by a successful mutation also expires on close',async()=>{
 const f=fixture();await f.window.mediaManager('first');const read=deferred();f.transport((path,opt)=>opt.method==='DELETE'?{ok:true,deleted:['photo']}:read.promise);const deleting=f.window.deletePhoto('first','photo');await new Promise(setImmediate);assert.equal(f.requests.length,3);f.close();read.resolve([photo]);await deleting;assert.equal(f.sheets.length,1);
});
test('completed upload does not repaint or reopen the closed mounted gallery',async()=>{
 const f=fixture();await f.window.mediaManager('first');f.context.addPhotoFiles([file]);const upload=f.context.PCS.queue[0],write=deferred();f.transport((path,opt)=>opt.method==='POST'?write.promise:[photo]);const uploading=f.window.uploadPhotoQueue();await new Promise(setImmediate);const grid=f.nodes.queueGrid;f.close();grid.innerHTML='Closed gallery snapshot';write.resolve({ok:true,id:upload.id});await uploading;
 assert.equal(upload.status,'done');assert.equal(grid.innerHTML,'Closed gallery snapshot');assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);assert.equal(f.context.PCS.mediaBusy,false);
});
test('file picker response cannot add a queue after close or to a different item',async()=>{
 for(const action of ['close','replace']){
  const f=fixture();await f.window.mediaManager('first');const oldPicker=f.nodes.photoInput;
  if(action==='close')f.close();else await f.window.mediaManager('second');oldPicker.onchange({target:{files:[file]}});assert.equal(f.context.PCS.queue.length,0,action);
 }
});
test('closed mounted editor cannot start a new delete or upload',async()=>{
 const f=fixture();await f.window.mediaManager('first');f.context.addPhotoFiles([file]);f.close();await f.window.deletePhoto('first','photo');await f.window.uploadPhotoQueue();assert.equal(f.requests.length,1);assert.equal(f.context.PCS.mediaBusy,undefined);
});
test('an active gallery still refreshes once after confirmed deletion',async()=>{
 const f=fixture();await f.window.mediaManager('first');await f.window.deletePhoto('first','photo');assert.equal(f.sheets.length,2);assert.equal(f.requests.length,3);assert.equal(f.context.PCS.mediaBusy,false);
});

function inlineSource(f,sheetIndex=f.sheets.length-1){const sequence=f.sheets[sheetIndex].body.match(/data-pcs-media-session="([^"]+)"/)[1];return{dataset:{confirm:'1'},closest:()=>({dataset:{pcsMediaSession:sequence},querySelectorAll:()=>[{value:'photo'}]})};}
test('old inline clear, remove, upload, cover, delete and batch-delete cannot borrow a reopened gallery session',async()=>{
 for(const reopened of ['first','second']){
  const f=fixture();await f.window.mediaManager('first');const old=inlineSource(f);await f.window.mediaManager(reopened);f.context.addPhotoFiles([file]);const queue=f.context.PCS.queue,queued=queue[0],count=f.requests.length;
  f.context.window.clearPhotoQueue(old);f.context.window.removeQueued(queued.id,old);await f.window.uploadPhotoQueue(old);await f.window.makeMain('first','photo',old);await f.window.deletePhoto('first','photo',old);await f.window.deleteSelectedPhotos('first',old);
  assert.equal(f.context.PCS.queue,queue,reopened);assert.equal(queue.length,1,reopened);assert.equal(queue[0],queued,reopened);assert.equal(f.requests.length,count,reopened);
 }
});
test('current inline queue controls work and gallery actions share the whole-sheet session wrapper',async()=>{
 const f=fixture();await f.window.mediaManager('first');const current=inlineSource(f);assert.match(f.sheets[0].body,/onclick="uploadPhotoQueue\(this\)"/);assert.match(f.sheets[0].body,/onclick="clearPhotoQueue\(this\)"/);assert.match(f.sheets[0].body,/deleteSelectedPhotos\('first',this\)/);
 f.context.addPhotoFiles([file]);f.context.removeQueued(f.context.PCS.queue[0].id,current);assert.equal(f.context.PCS.queue.length,0);f.context.addPhotoFiles([file]);f.context.clearPhotoQueue(current);assert.equal(f.context.PCS.queue.length,0);
 await f.window.deleteSelectedPhotos('first',current);assert.equal(f.requests.filter(x=>x.opt.method==='DELETE').length,1);assert.equal(f.sheets.length,2);
});
test('current inline cover and single delete remain functional',async()=>{
 for(const action of ['cover','delete']){
  const f=fixture();await f.window.mediaManager('first');const source=inlineSource(f);f.transport((path,opt)=>opt.method==='POST'?{ok:true,id:'first',ids:['photo']}:opt.method==='DELETE'?{ok:true,deleted:['photo']}:[photo]);
  if(action==='cover')await f.window.makeMain('first','photo',source);else await f.window.deletePhoto('first','photo',source);
  assert.equal(f.requests.filter(x=>x.opt.method==='POST'||x.opt.method==='DELETE').length,1,action);assert.equal(f.sheets.length,2,action);
 }
});
test('cover read resolving after close never starts its deferred reorder POST',async()=>{
 const f=fixture();await f.window.mediaManager('first');const source=inlineSource(f),read=deferred();f.transport(()=>read.promise);const ordering=f.window.makeMain('first','photo',source);f.close();read.resolve([photo]);await ordering;assert.equal(f.requests.filter(x=>x.opt.method==='POST').length,0);assert.equal(f.sheets.length,1);
});
test('closing an upload batch prevents the next queued file and the final gallery GET',async()=>{
 const f=fixture();await f.window.mediaManager('first');f.context.addPhotoFiles([file,{...file,name:'second.jpg'}]);const [first,second]=f.context.PCS.queue,write=deferred();f.transport(()=>write.promise);const uploading=f.window.uploadPhotoQueue(inlineSource(f));await new Promise(setImmediate);f.close();write.resolve({ok:true,id:first.id});await uploading;
 assert.equal(first.status,'done');assert.equal(second.status,'wait');assert.equal(f.requests.length,2);assert.equal(f.context.PCS.mediaBusy,false);
});
test('closing while FileReader is pending prevents the first upload POST',async()=>{
 const f=fixture();await f.window.mediaManager('first');f.context.addPhotoFiles([file]);let reader;f.context.FileReader=class{readAsDataURL(){reader=this;}};const uploading=f.window.uploadPhotoQueue(inlineSource(f));assert.ok(reader);f.close();reader.result='data:image/jpeg;base64,/9j/';reader.onload();await uploading;assert.equal(f.requests.length,1);assert.equal(f.context.PCS.mediaBusy,false);
});
test('upload refresh response after closing cannot write the captured catalog cache',async()=>{
 const f=fixture();await f.window.mediaManager('first');const cached=f.context.PCS.catalog[0].media_items;f.context.addPhotoFiles([file]);const queued=f.context.PCS.queue[0],read=deferred();f.transport((path,opt)=>opt.method==='POST'?{ok:true,id:queued.id}:read.promise);const uploading=f.window.uploadPhotoQueue(inlineSource(f));await new Promise(setImmediate);assert.equal(f.requests.length,3);f.close();read.resolve([{id:'stale-cache'}]);await uploading;assert.equal(f.context.PCS.catalog[0].media_items,cached);assert.equal(f.sheets.length,1);
});
test('a mismatched item id is rejected before using current gallery versions even without source',async()=>{
 const f=fixture();await f.window.mediaManager('second');const count=f.requests.length;await f.window.makeMain('first','photo');await f.window.deletePhoto('first','photo');await f.window.deleteSelectedPhotos('first');assert.equal(f.requests.length,count);
});
