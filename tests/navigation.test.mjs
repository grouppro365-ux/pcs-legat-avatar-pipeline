import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {validateManualSend} from '../server/supabase/pcs-manager-live2/manual-send.mjs';
import {contactPatch} from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
import {readFileSync} from 'node:fs';
const code=name=>readFileSync(new URL('../pcs-ai-operator-v6/'+name,import.meta.url),'utf8');
function fixture(){
 const elements=new Map();const classes=new Set();
 const mount=html=>{for(const el of elements.values())if(el.id!=='root')el.isConnected=false;for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,new El(id))};
 class El{constructor(id){this.id=id;this.isConnected=true;this._html='';this.dataset={};this.value=''}set innerHTML(v){this._html=v;if(this.id==='root')mount(v);else for(const [,id] of v.matchAll(/id="([^"]+)"/g))elements.set(id,new El(id))}get innerHTML(){return this._html}focus(){}}
 elements.set('root',new El('root'));
 const document={getElementById:id=>elements.get(id)||null,querySelector:s=>s.startsWith('#')?elements.get(s.slice(1)):null,body:{classList:{add(...c){c.forEach(x=>classes.add(x))},remove(...c){c.forEach(x=>classes.delete(x))},contains:c=>classes.has(c)}}};
 const context=vm.createContext({document,crypto:webcrypto,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},localStorage:{pcsToken:'fixture'},console,Promise,setTimeout,clearTimeout,URLSearchParams,Intl,Date});context.window=context;context.PCS={page:'dashboard'};context.scrollTo=()=>{};context.closeSheet=()=>classes.delete('sheet-open');context.shell=()=>'<main id="main"></main><nav class="bottom"></nav>';context.go=()=>{};context.call=()=>Promise.resolve([]);context.opsCall=context.call;
 vm.runInContext(code('navigation-lifecycle.js'),context);
 return {context,elements,classes};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
test('last navigation wins across delayed page results and nested tabs',async()=>{
 const {context:c}=fixture();const a=deferred(),b=deferred();const rendered=[];
 const page=(p,d)=>c.pcsNavigation.run(p,async()=>{const scope=c.pcsNavigation.capture();await d.promise;if(c.pcsNavigation.isCurrent(scope))rendered.push(p)});
 const old=page('catalog',a),latest=page('bookings',b);b.resolve();await latest;a.resolve();await old;assert.deepEqual(rendered,['bookings']);
 const prior=c.pcsNavigation.capture();c.pcsNavigation.run('bookings',()=>{});assert.equal(c.pcsNavigation.isCurrent(prior),false);
});
test('route invalidates deferred sheets even when sheet is not open',()=>{
 const {context:c,classes}=fixture();let invalidations=0,closed=0;c.pcsSheetLifecycle={invalidate(){invalidations++}};c.closeSheet=()=>closed++;
 c.pcsNavigation.run('inbox',()=>{});assert.equal(invalidations,1);assert.equal(closed,0);
 classes.add('sheet-open');c.pcsNavigation.run('catalog',()=>{});assert.equal(closed,1);
});
test('only latest completion notifies and rejected route remains handled',async()=>{
 const {context:c}=fixture();const a=deferred();let count=0;c.pcsNavigation.subscribe(()=>count++);
 const first=c.pcsNavigation.run('catalog',()=>a.promise);c.pcsNavigation.run('inbox',()=>{});a.resolve();await first;await Promise.resolve();assert.equal(count,1);
 await assert.rejects(c.pcsNavigation.run('finance',()=>Promise.reject(Error('offline'))),/offline/);await Promise.resolve();assert.equal(count,2);
});
test('actual approved CRM renderer discards response after leaving its mounted page',async()=>{
 const {context:c}=fixture();vm.runInContext(code('approved-pages-v1.js'),c);const pending=deferred();c.call=()=>pending.promise;
 const old=c.pcsNavigation.run('crm',()=>c.pcsApprovedPages.clients());
 c.pcsNavigation.run('inbox',()=>{c.document.getElementById('root').innerHTML='<main id="main">inbox</main>'});
 pending.resolve([{id:'old',name:'Old'}]);await old;assert.equal(c.PCS.page,'inbox');assert.equal(c.PCS.crm,undefined);assert.equal(c.document.getElementById('main').innerHTML,'');
});
test('actual tariff subtabs cannot paint late response over newer subtab',async()=>{
 const {context:c}=fixture();vm.runInContext(code('approved-pages-v1.js'),c);const old=deferred();let calls=0;c.opsCall=()=>++calls<=2?old.promise:Promise.resolve([]);c.call=()=>Promise.resolve([]);
 const first=c.pcsNavigation.run('bookings',()=>c.pcsApprovedPages.tariffs('directions'));
 await c.pcsNavigation.run('bookings',()=>c.pcsApprovedPages.tariffs('seasons'));
 const before=c.document.getElementById('pcsApTariffContent').innerHTML;old.resolve([]);await first;
 assert.equal(c.document.getElementById('pcsApTariffContent').innerHTML,before);assert.match(before,/Сезонные периоды/);
});

test('inbox contact switch clears old composer and ignores out of order contact detail',async()=>{
 const {context:c}=fixture();vm.runInContext(code('inbox-v25.js'),c);c.call=()=>Promise.resolve([]);
 await c.pcsNavigation.run('inbox',()=>c.pcsInbox25());
 const a=deferred(),b=deferred();c.call=path=>path.endsWith('/a')?a.promise:b.promise;
 const first=c.pcsInboxOpen25('a'),second=c.pcsInboxOpen25('b');
 assert.doesNotMatch(c.document.getElementById('in25ChatWrap').innerHTML,/in25Composer/);
 b.resolve({contact:{id:'b',name:'Bravo'}});await second;
 a.resolve({contact:{id:'a',name:'Alpha'}});await first;
 const html=c.document.getElementById('in25ChatWrap').innerHTML;
 assert.match(html,/Bravo/);assert.doesNotMatch(html,/Alpha/);
});
test('approved client row opens a real CRM detail workspace and preserves selected identity',async()=>{
 const {context:c}=fixture();const opened=[];
 c.go=async p=>{c.PCS.page=p;c.document.getElementById('root').innerHTML='<main id="main"><section id="crmDetail"></section></main>'};
 c.openClient=(id,switchPage)=>opened.push({id,switchPage});
 vm.runInContext(code('approved-pages-v1.js'),c);
 await c.pcsOpenClientWorkspace('client-2');
 assert.equal(c.PCS.page,'crm');assert.equal(c.PCS.crmId,'client-2');assert.ok(c.document.getElementById('crmDetail'));assert.deepEqual(opened,[{id:'client-2',switchPage:false}]);
});

async function inboxReady(){
 const f=fixture(),c=f.context;vm.runInContext(code('inbox-v25.js'),c);c.call=()=>Promise.resolve([]);await c.pcsNavigation.run('inbox',()=>c.pcsInbox25());
 c.call=()=>Promise.resolve({contact:{id:'client_a',name:'Alice',edit_version:'2026-10-16 12:34:56.123456'}});await c.pcsInboxOpen25('client_a');return f;
}
test('actual inbox send passes server contract and retries unknown outcome with identical request fingerprint',async()=>{
 const {context:c}=await inboxReady();const payloads=[];c.document.getElementById('in25Composer').value='Reviewed message';
 c.call=async(path,opt)=>{if(!opt)return {contact:{id:'client_a',name:'Alice'}};const body=JSON.parse(opt.body);validateManualSend('client_a',body);payloads.push(body);throw Error('Network response lost')};
 await c.pcsInboxSend25();const box=c.document.getElementById('in25Composer');assert.equal(box.readOnly,true);box.value='Changed after send';await c.pcsInboxSend25();
 assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);assert.equal(payloads[0].text,'Reviewed message');
 assert.match(c.document.getElementById('in25SendStatus').textContent,/Доставка не подтверждена/);
});
test('inbox duplicate press claims one send and late completion cannot clear another contact composer',async()=>{
 const {context:c}=await inboxReady();const pending=deferred();let sends=0;c.document.getElementById('in25Composer').value='Message A';
 c.call=async(path,opt)=>{if(opt){sends++;validateManualSend('client_a',JSON.parse(opt.body));return pending.promise}return {contact:{id:'client_b',name:'Bob'}}};
 const send=c.pcsInboxSend25();await c.pcsInboxSend25();assert.equal(sends,1);await c.pcsInboxOpen25('client_b');const newer=c.document.getElementById('in25Composer');newer.value='Draft B';pending.resolve({ok:true});await send;assert.equal(newer.value,'Draft B');
});
test('inbox request edit carries exact server revision and no inferred status',async()=>{
 const {context:c,elements}=await inboxReady();let payload;
 elements.set('in25Need',{value:'Need a car',dataset:{contact:'client_a',version:'2026-10-16 12:34:56.123456'}});elements.set('in25Next',{value:'Ask dates'});
 c.toast=()=>{};c.call=async(path,opt)=>{if(opt){payload=JSON.parse(opt.body);contactPatch(payload);return {ok:true}}return path==='/crm'?[]:{contact:{id:'client_a',name:'Alice'}}};
 await c.pcsInboxSaveRequest25('client_a');assert.equal(payload.expected_version,'2026-10-16 12:34:56.123456');assert.equal(payload.need,'Need a car');assert.equal(Object.hasOwn(payload,'status'),false);
});
test('confirmed send on an abandoned composer cannot become a fresh duplicate when revisiting same contact',async()=>{
 const {context:c}=await inboxReady();const pending=deferred();let sends=0;c.document.getElementById('in25Composer').value='Message A';
 c.call=async(path,opt)=>{if(opt){sends++;return pending.promise}return {contact:{id:'client_a',name:'Alice'}}};
 const sending=c.pcsInboxSend25();c.pcsNavigation.run('inbox',()=>{});await c.pcsInboxOpen25('client_a');
 const newBox=c.document.getElementById('in25Composer');newBox.value='Message A';pending.resolve({ok:true});await sending;
 await c.pcsInboxSend25();assert.equal(sends,1);assert.equal(newBox.value,'');assert.equal(newBox.readOnly,false);
});
