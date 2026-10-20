import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../pcs-ai-operator-v6/content-workflow.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
class Element {
 constructor(){this.children=[];this.controls=new Map();this.elements={};this.isConnected=false;this.disabled=false;}
 set innerHTML(html){for(const c of this.children)c.isConnected=false;this.children=[];this.controls.clear();this.html=html;
  for(const m of html.matchAll(/name="([^"]+)"/g))this.elements[m[1]]={value:''};
 }
 get innerHTML(){return this.html;}
 append(el){this.children.push(el);el.isConnected=true;}
 scrollIntoView(){}
 addEventListener(type,fn){this['on'+type]=fn;}
 querySelector(selector){if(!this.controls.has(selector)){
  const key=selector.slice(1,-1);if(!this.html.includes(key)&&!this.html.includes(key.replace('=','=\"')+'\"'))return null;
  this.controls.set(selector,new Element());
 }return this.controls.get(selector);}
 querySelectorAll(selectors){return selectors.split(',').map(s=>this.querySelector(s)).filter(Boolean);}
}
async function fixture(){
 let root,epoch=0;const requests=[],sheets=[];
 const document={getElementById:id=>id==='pcsContentRoot'?root:null,createElement:()=>new Element(),addEventListener(){}};
 const window={pcsSheetLifecycle:{capture:()=>epoch,current:t=>t===epoch},
  openSheet(){epoch++;root=new Element();root.innerHTML='Loading';root.isConnected=true;sheets.push(root);},
  pcsManagerRequest(op,opt){const d=deferred();requests.push({op,...opt,...d});return d.promise;}};
 class FormData {constructor(form){this.entries=Object.entries(form.elements).map(([k,v])=>[k,v.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 vm.runInNewContext(source,{window,document,FormData,crypto:{randomUUID},Date});
 const opened=window.pcsContent.open();requests[0].resolve({permissions:['*'],brands:[{id:'brand',name:'PCS',version:2,guidelines:'Accurate'}],posts:[],platforms:['telegram'],languages:['ru']});await opened;
 return{window,requests,sheets,get root(){return root;},invalidate(){epoch++;},edit(kind='new'){root.querySelector(`[data-${kind}]`).onclick();const form=root.children[0];if(kind==='brand'){form.elements.name.value='PCS';form.elements.guidelines.value='Accurate';}else for(const [k,v] of Object.entries({brand_id:'brand',platform:'telegram',language:'ru',title:'Title',source_facts:'Facts',source_url:'https://example.test',body:'Body'}))form.elements[k].value=v;return form;}};
}
const submit=form=>form.onsubmit({preventDefault(){},submitter:null});
for(const kind of ['new','brand']){
 test(`${kind}: repeated submit while saving makes one request, including keyboard submit`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);await submit(form);
  assert.equal(f.requests.length,2);assert.equal(form.querySelector('[type=submit]').disabled,true);
  f.requests[1].reject(new Error('Retry'));await saving;assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(form.querySelector('[data-error]').textContent,'Retry');
 });
 test(`${kind}: cancel and open another form suppresses old save success`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);form.querySelector('[data-cancel]').onclick();const replacement=f.edit(kind);
  f.requests[1].resolve({id:'old'});await saving;
  assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);assert.equal(f.root.children[0],replacement);
 });
 test(`${kind}: current successful save opens the saved result`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);f.requests[1].resolve({id:'saved'});await saving;
  assert.equal(f.sheets.length,2);assert.equal(f.requests.length,3);assert.equal(f.requests[2].op,'content-workflow');assert.equal(f.requests[2].params.id,kind==='brand'?undefined:'saved');
  f.requests[2].resolve({permissions:['*'],brands:[],posts:[],platforms:[],languages:[]});await Promise.resolve();
 });
 test(`${kind}: failure of a cancelled save cannot touch the replacement editor`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);form.querySelector('[data-cancel]').onclick();const replacement=f.edit(kind);f.requests[1].reject(new Error('Old failure'));await saving;
  assert.equal(replacement.querySelector('[data-error]').textContent,undefined);assert.equal(f.root.children[0],replacement);
 });
 test(`${kind}: retries reuse a request ID only for the same payload`,async()=>{
  const f=await fixture(),form=f.edit(kind);let saving=submit(form);f.requests[1].reject(new Error('Network'));await saving;
  saving=submit(form);assert.equal(f.requests[2].body.request_id,f.requests[1].body.request_id);f.requests[2].reject(new Error('Network'));await saving;
  form.elements[kind==='brand'?'guidelines':'body'].value='Changed';saving=submit(form);assert.notEqual(f.requests[3].body.request_id,f.requests[2].body.request_id);f.requests[3].reject(new Error('Network'));await saving;
 });
 test(`${kind}: closing the sheet with mounted nodes prevents a save from reopening it`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);f.invalidate();f.requests[1].resolve({id:'old'});await saving;assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);
 });
}
test('brand editor and content editor cannot accumulate duplicate forms',async()=>{
 const f=await fixture();f.edit('brand');f.root.querySelector('[data-brand]').onclick();f.root.querySelector('[data-new]').onclick();assert.equal(f.root.children.length,1);assert.equal(f.root.querySelector('[data-brand]').disabled,true);
});
test('generation rejects changed inputs and does not overlap a save',async()=>{
 const f=await fixture(),form=f.edit(),generate=form.querySelector('[data-generate]');const generating=generate.onclick({currentTarget:generate});await submit(form);assert.equal(f.requests.length,2);
 form.elements.source_facts.value='Changed facts';f.requests[1].resolve({body:'Stale generated body'});await generating;
 assert.equal(form.elements.body.value,'Body');assert.match(form.querySelector('[data-error]').textContent,/Поля изменились/);assert.equal(generate.disabled,false);
});
test('cancelled generation cannot edit a replacement form',async()=>{
 const f=await fixture(),form=f.edit(),generate=form.querySelector('[data-generate]');const generating=generate.onclick({currentTarget:generate});form.querySelector('[data-cancel]').onclick();const replacement=f.edit();f.requests[1].resolve({body:'Stale'});await generating;assert.equal(replacement.elements.body.value,'Body');
});
test('late load cannot paint a sheet closed while its root remains mounted',async()=>{
 const f=await fixture();const loading=f.window.pcsContent.open();f.invalidate();f.requests[1].resolve({permissions:['*'],brands:[],posts:[],platforms:[],languages:[]});await loading;assert.equal(f.root.innerHTML,'Loading');
});
