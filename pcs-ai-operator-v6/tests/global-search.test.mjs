import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const pending=[],nodes={},sheets=[],opened=[],buttons=[];
 const node=()=>({innerHTML:'',textContent:'',value:'',listeners:{},addEventListener(k,f){this.listeners[k]=f},querySelectorAll(selector){return selector==='[data-result]'?buttons:[]}});
 const window={},document={getElementById:id=>nodes[id],addEventListener(){}};
 const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 vm.runInNewContext(readFileSync(new URL('../global-search.js',import.meta.url),'utf8'),{window,document,esc,URLSearchParams,call:url=>new Promise(resolve=>pending.push({url,resolve})),openSheet:(title,html)=>{sheets.push({title,html});for(const id of ['pcsSearchForm','pcsSearchQuery','pcsSearchScope','pcsSearchResults'])nodes[id]=node()},closeSheet(){},openClient:(...args)=>opened.push(args)});
 return{window,nodes,sheets,pending,opened,buttons};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('late response cannot replace newer query or a reopened search sheet',async()=>{
 const h=fixture();h.window.pcsSearch.open('old');const old=h.nodes.pcsSearchResults;
 h.window.pcsSearch.open('new');const current=h.nodes.pcsSearchResults;
 h.pending[1].resolve({groups:[{scope:'contacts',rows:[{title:'new result'}]}]});await tick();assert.match(current.innerHTML,/new result/);
 h.pending[0].resolve({groups:[{scope:'contacts',rows:[{title:'old result'}]}]});await tick();assert.doesNotMatch(current.innerHTML,/old result/);assert.equal(old.innerHTML,'');
});
test('results and failed source text are escaped, pagination uses lookahead',async()=>{
 const h=fixture();h.window.pcsSearch.open('<img>');assert.match(h.sheets[0].html,/&lt;img>/);
 h.pending[0].resolve({groups:[{scope:'contacts',rows:[{title:'<script>bad</script>',phone:'<img>'}],truncated:true},{scope:'partners',rows:[],error:'<unsafe>'}]});await tick();
 const html=h.nodes.pcsSearchResults.innerHTML;assert.doesNotMatch(html,/<script>|<img>|<unsafe>/);assert.match(html,/&lt;script>/);assert.match(html,/&lt;unsafe>/);assert.match(html,/data-page="next" >Далее/);
});

test('search opens clients on CRM and applications in their current workspace',async()=>{
 for(const scope of ['contacts','messages','applications']){const h=fixture();let click,application;h.buttons.push({dataset:{result:'0'},addEventListener:(name,fn)=>click=fn});h.window.pcsApplications={openDetail:id=>application=id};h.window.pcsSearch.open('demo');h.pending[0].resolve({groups:[{scope,rows:[{id:'11111111-1111-4111-8111-111111111111',contact_id:'contact_1',title:'Found'}]}]});await tick();click();if(scope==='applications')assert.equal(application,'11111111-1111-4111-8111-111111111111');else assert.deepEqual(h.opened,[[scope==='contacts'?'11111111-1111-4111-8111-111111111111':'contact_1']]);}
});
test('content results show escaped brand/platform/language and open the exact existing content card',async()=>{
 const h=fixture();let click,opened;h.buttons.push({dataset:{result:'0'},addEventListener:(name,fn)=>click=fn});h.window.pcsContent={open:args=>opened=args};h.window.pcsSearch.open('PCS');
 assert.match(h.sheets[0].html,/<option value="content">Контент<\/option>/);
 const id='11111111-1111-4111-8111-111111111111';h.pending[0].resolve({groups:[{scope:'content',rows:[{id,title:'<script>Draft</script>',brand_name:'<brand>',platform:'telegram',language:'ru',summary:'<img>Body'}],truncated:true}]});await tick();
 const html=h.nodes.pcsSearchResults.innerHTML;assert.doesNotMatch(html,/<script>|<brand>|<img>/);assert.match(html,/&lt;brand>/);assert.match(html,/telegram · ru/);click();assert.equal(opened.id,id);assert.deepEqual(Object.keys(opened),['id']);assert.deepEqual(h.opened,[]);
});
test('invalid content identity or missing editor cannot redirect to another type of record',async()=>{
 for(const id of ['client_1','11111111-1111-4111-8111-111111111111']){const h=fixture();let click,opened;h.buttons.push({dataset:{result:'0'},addEventListener:(name,fn)=>click=fn});if(id==='client_1')h.window.pcsContent={open:args=>opened=args};h.window.pcsSearch.open('PCS');h.pending[0].resolve({groups:[{scope:'content',rows:[{id,title:'Found'}]}]});await tick();click();assert.equal(opened,undefined);assert.deepEqual(h.opened,[]);assert.equal(h.sheets.length,1);}
});
test('late content result cannot repaint a replacement search sheet',async()=>{
 const h=fixture();h.window.pcsSearch.open('old topic');h.window.pcsSearch.open('new topic');const current=h.nodes.pcsSearchResults;
 h.pending[1].resolve({groups:[{scope:'content',rows:[{id:'11111111-1111-4111-8111-111111111111',title:'Current draft'}]}]});await tick();h.pending[0].resolve({groups:[{scope:'content',rows:[{title:'Stale draft'}]}]});await tick();assert.match(current.innerHTML,/Current draft/);assert.doesNotMatch(current.innerHTML,/Stale draft/);
});
