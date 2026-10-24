import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=f=>readFileSync(new URL('../pcs-ai-operator-v6/'+f,import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const dom=new JSDOM('<div id="root"><main id="main"></main></div>',{url:'https://pcs.test',runScripts:'outside-only'}),w=dom.window,calls=[],edits=[];
 w.PCS={page:'dashboard'};w.scrollTo=()=>{};w.shell=()=>'<main id="main"></main>';w.editKnowledge=id=>edits.push(id);
 w.call=url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}));w.eval(source('navigation-lifecycle.js'));w.eval(source('knowledge-workspace.js'));
 return{w,calls,edits,document:w.document,open:()=>w.pcsNavigation.run('kb',()=>w.pcsKnowledge26())};
}
const response=(title='Current',extra={})=>({page:0,q:'',view:'all',rows:[{id,revision:1,title}],has_more:true,...extra});
test('retained knowledge nodes ignore success/error after navigation and cannot overwrite shared editor rows',async()=>{
 for(const error of [false,true]){
  const h=fixture(),pending=h.open(),root=h.document.getElementById('kbLiveRows'),before=root.textContent;h.w.__PCS_KB_ROWS__=[{title:'New route cache'}];
  h.w.pcsNavigation.run('catalog',()=>{});if(error)h.calls[0].reject(Error('Old error'));else h.calls[0].resolve(response('Old facts'));await pending;
  assert.equal(root.textContent,before);assert.equal(h.w.__PCS_KB_ROWS__[0].title,'New route cache');assert.equal(h.w.PCS.page,'catalog');h.w.close();
 }
});
test('a route roundtrip invalidates a knowledge response even if same root and page are retained',async()=>{
 const h=fixture(),pending=h.open(),root=h.document.getElementById('kbLiveRows');h.w.pcsNavigation.run('catalog',()=>{});h.w.pcsNavigation.run('kb',()=>{});h.calls[0].resolve(response('Stale facts'));await pending;assert.doesNotMatch(root.textContent,/Stale facts/);assert.equal(h.w.__PCS_KB_ROWS__,undefined);h.w.close();
});
test('retained add, edit, search, filter and paging handlers cannot act after departure',async()=>{
 const h=fixture(),pending=h.open();h.calls[0].resolve(response());await pending;
 const add=h.document.getElementById('kbLiveAdd'),edit=h.document.querySelector('[data-knowledge-edit]'),form=h.document.getElementById('kbLiveForm'),filter=h.document.getElementById('kbLiveView'),next=h.document.getElementById('kbLiveNext'),prev=h.document.getElementById('kbLivePrev');
 h.w.pcsNavigation.run('inbox',()=>{});add.onclick();edit.onclick();form.onsubmit({preventDefault(){}});filter.value='expired';filter.onchange();next.onclick();prev.onclick();
 assert.equal(h.calls.length,1);assert.deepEqual(h.edits,[]);h.w.close();
});
test('editor actions remain available on the current knowledge route',async()=>{
 const h=fixture(),pending=h.open();h.calls[0].resolve(response());await pending;h.document.querySelector('[data-knowledge-edit]').click();h.document.getElementById('kbLiveAdd').click();assert.deepEqual(h.edits,[id,undefined]);h.w.close();
});
test('pending paging ignores repeated retained next handler and preserves the requested page',async()=>{
 const h=fixture(),pending=h.open();h.calls[0].resolve(response());await pending;const next=h.document.getElementById('kbLiveNext');next.onclick();next.onclick();assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/page=1/);h.calls[1].resolve(response('Page 2',{page:1}));await tick();assert.match(h.document.getElementById('kbLivePage').textContent,/Страница 2/);h.w.close();
});
