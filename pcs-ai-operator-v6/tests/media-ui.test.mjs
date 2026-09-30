import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const id='11111111-1111-4111-8111-111111111111';
function harness(){
 const item={id,title:'MG5',media_items:[]},calls=[],sheets=[];
 const nodes={};const node=key=>nodes[key]||=( {classList:{toggle(){},add(){},remove(){}},style:{},addEventListener(){},dataset:{},innerHTML:'',textContent:''});
 const PCS={catalog:[item]};
 const context={PCS,window:{},document:{getElementById:node,querySelectorAll:()=>[]},$:node,
  openSheet:(title,body)=>sheets.push({title,body}),esc:s=>String(s||''),toast(){},confirm:()=>true,
  crypto:{randomUUID:()=>String(calls.length)},URL:{createObjectURL:()=>'/preview',revokeObjectURL(){}},
  FileReader:class{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/';this.onload()}},
  call:async(path,opt={})=>{calls.push({path,opt});if(opt.method==='POST')return{ok:true};return [{id:'photo-a',public_url:'https://example.test/a.jpg'}]},setTimeout(){}};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../media.js',import.meta.url),'utf8'),context);
 return {context,item,calls,sheets};
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
 const h=harness();h.context.call=async(path,opt={})=>{h.calls.push({path,opt});return [{id:'photo-a',public_url:'https://example.test/a.jpg'},{id:'photo-b',public_url:'https://example.test/b.jpg'}]};
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
 assert.equal(deleted.path,'/catalog/'+id+'/media');
});
