import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../pcs-ai-operator-v6/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
function lifecycleFixture(){
 let main={};const window={PCS:{page:'catalog'}};
 const document={getElementById:id=>id==='main'?main:null};
 vm.runInNewContext(source('sheet-lifecycle.js'),{window,document});
 return {window,document,api:window.pcsSheetLifecycle,navigate:page=>{window.PCS.page=page;main={}}};
}
test('deferred sheet intents expire on competing forms, close and same-page navigation',()=>{
 const f=lifecycleFixture(),a=f.api.begin();assert.equal(f.api.current(a),true);
 const b=f.api.begin();assert.equal(f.api.current(a),false);assert.equal(f.api.current(b),true);
 f.api.invalidate();assert.equal(f.api.current(b),false);
 const c=f.api.begin();f.navigate('catalog');assert.equal(f.api.current(c),false);
});
test('slower CRM editor response cannot replace the most recently requested client',async()=>{
 const f=lifecycleFixture(),pending=new Map(),sheets=[];
 f.window.call=path=>{const d=deferred();pending.set(path,d);return d.promise};
 f.window.toast=()=>{};f.window.openSheet=(title,html)=>{f.api.invalidate();sheets.push(html)};
 vm.runInNewContext(source('crm-editor.js'),{window:f.window,document:f.document,crypto:globalThis.crypto,Date});
 const first=f.window.pcsCrmEditor.edit('first'),second=f.window.pcsCrmEditor.edit('second');
 pending.get('/crm/second').resolve({contact:{name:'Second'}});await second;
 pending.get('/crm/first').resolve({contact:{name:'First'}});await first;
 assert.equal(sheets.length,1);assert.match(sheets[0],/Second/);
});
test('CRM editor does not open after leaving its rendered page',async()=>{
 const f=lifecycleFixture(),d=deferred(),sheets=[];f.window.call=()=>d.promise;f.window.openSheet=(...args)=>sheets.push(args);f.window.toast=()=>{};
 vm.runInNewContext(source('crm-editor.js'),{window:f.window,document:f.document,crypto:globalThis.crypto,Date});
 const pending=f.window.pcsCrmEditor.edit('first');f.navigate('kb');d.resolve({contact:{name:'First'}});await pending;assert.equal(sheets.length,0);
});
test('price save finishing on another tab leaves its page and replacement sheet intact',async()=>{
 const done=deferred(),nodes={basePrice:{value:'100'},catalogPriceSave:{},catalogPriceError:{},catalogPriceVersion:{value:'v1'}};
 let sequence=1,closed=0,renders=0,reads=0;
 const PCS={page:'catalog',catalog:[]};const window={PCS,pricingManager:async()=>{},pcsNavigation:{capture:()=>sequence,isCurrent:value=>value===sequence}};
 const document={querySelector:selector=>nodes[selector.slice(1)]};
 const context={window,PCS,document,adminCall:()=>done.promise,call:async()=>{reads++;return[]},catalog:async()=>renders++,closeSheet:()=>closed++,toast:()=>{},esc:String};
 vm.runInNewContext(source('catalog-safety.js'),context);
 const pending=window.saveBasePrice('car');sequence++;PCS.page='crm';nodes.basePrice={value:'another'};done.resolve({ok:true});await pending;
 assert.equal(closed,0);assert.equal(reads,0);assert.equal(renders,0);
});
test('a pending contract read cannot reopen a sheet after navigation',async()=>{
 const f=lifecycleFixture(),d=deferred(),sheets=[];
 const context={window:f.window,document:f.document,localStorage:{pcsToken:'x'},fetch:()=>d.promise,openSheet:(...args)=>{f.api.invalidate();sheets.push(args)},toast:()=>{},esc:String};
 vm.runInNewContext(source('contracts.js'),context);
 const pending=f.window.contractCenter('booking');f.navigate('crm');d.resolve({ok:true,json:async()=>[]});await pending;assert.equal(sheets.length,0);
});
function appFixture(){
 const nodes={root:{innerHTML:''},main:{},sheetbox:{innerHTML:''},sheet:{classList:{add(){},remove(){}}},pw:{value:'secret',focus(){}},loginSubmit:{disabled:false,textContent:'Войти'},err:{textContent:''}};
 const requests=[];const window={};
 const document={querySelector:selector=>nodes[selector.slice(1)]||null,getElementById:id=>nodes[id]||null,addEventListener(){},body:{classList:{add(){},remove(){}}}};
 const context={window,document,localStorage:{removeItem(){}},setTimeout:()=>{},URL:{revokeObjectURL(){}},fetch:async(url,opt)=>{const d=deferred();requests.push({url,opt,...d});return d.promise}};
 vm.createContext(context);vm.runInContext(source('sheet-lifecycle.js'),context);vm.runInContext(source('app.js'),context);window.PCS.page='catalog';window.PCS.catalog=[{id:'one',title:'Car one',price:10},{id:'two',title:'Car two',price:20}];
 return{window,nodes,requests};
}
test('pricing responses arriving out of order show only the last requested item',async()=>{
 const f=appFixture();const a=f.window.pricingManager('one'),b=f.window.pricingManager('two');
 f.requests[1].resolve({ok:true,json:async()=>[]});await b;
 f.requests[0].resolve({ok:true,json:async()=>[]});assert.equal(await a,false);
 assert.match(f.nodes.sheetbox.innerHTML,/Car two/);assert.doesNotMatch(f.nodes.sheetbox.innerHTML,/Car one/);
});
test('pricing cannot open after its loading intent was explicitly closed',async()=>{
 const f=appFixture();const pending=f.window.pricingManager('one');f.window.closeSheet();
 f.requests[0].resolve({ok:true,json:async()=>[]});assert.equal(await pending,false);assert.equal(f.nodes.sheetbox.innerHTML,'');
});
test('double login taps send once and rejected login restores a retryable form',async()=>{
 const f=appFixture();const pending=f.window.doLogin();await f.window.doLogin();assert.equal(f.requests.length,1);assert.equal(f.nodes.loginSubmit.disabled,true);
 f.requests[0].resolve({ok:false,status:401,json:async()=>({error:'Неверный пароль'})});await pending;
 assert.equal(f.nodes.loginSubmit.disabled,false);assert.match(f.nodes.err.textContent,/Неверный пароль/);
});
test('out-of-order CRM detail requests cannot show the previous client',async()=>{
 const f=appFixture();f.window.PCS.page='crm';f.nodes.crmSearch={value:''};f.nodes.crmList={innerHTML:''};f.nodes.crmDetail={innerHTML:''};
 const first=f.window.openClient('one',false),second=f.window.openClient('two',false);
 f.requests[1].resolve({ok:true,json:async()=>({contact:{id:'two',name:'Second client'},tasks:[]})});await second;
 f.requests[0].resolve({ok:true,json:async()=>({contact:{id:'one',name:'First client'},tasks:[]})});await first;
 assert.match(f.nodes.crmDetail.innerHTML,/Second client/);assert.doesNotMatch(f.nodes.crmDetail.innerHTML,/First client/);
});
test('CRM links from the approved client list open the actual workspace hook',async()=>{
 const f=appFixture(),opened=[];f.window.PCS.page='crm';f.window.pcsOpenClientWorkspace=async id=>opened.push(id);
 await f.window.openClient('one');assert.deepEqual(opened,['one']);assert.equal(f.requests.length,0);
});
test('PDF preparation does not reopen a download sheet after leaving the page',async()=>{
 const f=lifecycleFixture(),d=deferred(),sheets=[];
 f.document.currentScript={src:'https://example.test/contract-pdf-v5.js'};f.window.toast=()=>{};f.window.openSheet=(...args)=>sheets.push(args);f.window.contractCall=()=>d.promise;
 vm.runInNewContext(source('contract-pdf-v5.js'),{window:f.window,document:f.document,URL});
 const pending=f.window.downloadContractPdf('contract');f.navigate('inbox');d.resolve({status:'ready_to_sign'});await pending;assert.equal(sheets.length,0);
});
test('a delayed contract attestation form cannot reopen after close',async()=>{
 const f=lifecycleFixture(),d=deferred(),sheets=[];f.window.contractCall=()=>d.promise;f.window.toast=()=>{};f.window.openSheet=(...args)=>sheets.push(args);
 vm.runInNewContext(source('contract-confirmations.js'),{window:f.window,document:f.document,Date});
 const pending=f.window.pcsContractConfirmations.form('contract','handover');f.api.invalidate();d.resolve({id:'contract',status:'ready_to_sign'});await pending;assert.equal(sheets.length,0);
});
test('contract history respects a newer sheet opening intent',async()=>{
 const f=lifecycleFixture(),d=deferred(),sheets=[];f.window.contractCall=()=>d.promise;f.window.toast=()=>{};f.window.openSheet=(...args)=>sheets.push(args);
 vm.runInNewContext(source('contract-history.js'),{window:f.window,document:f.document,Date});
 const pending=f.window.pcsContractHistory.open('abcd-1234');f.api.begin();d.resolve({versions:[],events:[]});await pending;assert.equal(sheets.length,0);
});
test('document list response is tied to the exact mounted host even for the same reservation',async()=>{
 const f=lifecycleFixture(),d=deferred(),oldHost={dataset:{reservation:'same'}},newHost={dataset:{reservation:'same'}},nodes={ctDocuments:oldHost,ctDocumentList:{innerHTML:'new list'},ctDocumentStatus:{textContent:''}};
 const original=f.document.getElementById;f.document.getElementById=id=>nodes[id]||original(id);f.document.querySelectorAll=()=>[];
 vm.runInNewContext(source('contract-documents.js'),{window:f.window,document:f.document,localStorage:{},fetch:()=>d.promise});
 const pending=f.window.pcsContractDocuments.mount({id:'old-contract',reservation_id:'same'});nodes.ctDocuments=newHost;
 d.resolve({ok:true,json:async()=>[{name:'old-passport.jpg'}]});await pending;assert.equal(nodes.ctDocumentList.innerHTML,'new list');
});
test('document list response cannot modify a closed sheet whose nodes remain mounted',async()=>{
 const f=lifecycleFixture(),d=deferred(),nodes={ctDocuments:{dataset:{reservation:'same'}},ctDocumentList:{innerHTML:'unchanged'},ctDocumentStatus:{textContent:''}};
 const original=f.document.getElementById;f.document.getElementById=id=>nodes[id]||original(id);f.document.querySelectorAll=()=>[];
 vm.runInNewContext(source('contract-documents.js'),{window:f.window,document:f.document,localStorage:{},fetch:()=>d.promise});
 const pending=f.window.pcsContractDocuments.mount({id:'contract',reservation_id:'same'});f.api.invalidate();
 d.resolve({ok:true,json:async()=>[{name:'passport.jpg'}]});await pending;assert.equal(nodes.ctDocumentList.innerHTML,'unchanged');
});
test('successful price saves refresh through the current catalog route, preserving approved navigation',async()=>{
 const nodes={basePrice:{value:'100'},catalogPriceSave:{},catalogPriceError:{},catalogPriceVersion:{value:'v1'}},routes=[];
 let sequence=1,legacyRenders=0;const PCS={page:'catalog',catalog:[]};
 const window={PCS,pricingManager:async()=>{},go:async page=>{sequence++;routes.push(page)},pcsNavigation:{capture:()=>sequence,isCurrent:value=>value===sequence}};
 vm.runInNewContext(source('catalog-safety.js'),{window,PCS,document:{querySelector:s=>nodes[s.slice(1)]},adminCall:async()=>({ok:true}),call:async()=>[{id:'car'}],catalog:async()=>legacyRenders++,closeSheet:()=>{},toast:()=>{},esc:String});
 await window.saveBasePrice('car');assert.deepEqual(routes,['catalog']);assert.equal(legacyRenders,0);assert.equal(PCS.catalog[0].id,'car');
});
