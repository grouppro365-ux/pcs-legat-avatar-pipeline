import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const pending=[],nodes={},sheets=[],opened=[];
 const node=()=>({innerHTML:'',textContent:'',value:'',listeners:{},addEventListener(k,f){this.listeners[k]=f},querySelectorAll(){return[]}});
 const window={},document={getElementById:id=>nodes[id],addEventListener(){}};
 const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 vm.runInNewContext(readFileSync(new URL('../global-search.js',import.meta.url),'utf8'),{window,document,esc,URLSearchParams,call:url=>new Promise(resolve=>pending.push({url,resolve})),openSheet:(title,html)=>{sheets.push({title,html});for(const id of ['pcsSearchForm','pcsSearchQuery','pcsSearchScope','pcsSearchResults'])nodes[id]=node()},closeSheet(){},openClient:(...args)=>opened.push(args)});
 return{window,nodes,sheets,pending};
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
