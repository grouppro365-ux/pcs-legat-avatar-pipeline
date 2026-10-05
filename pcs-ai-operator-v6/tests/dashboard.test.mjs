import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const pending=[],nodes={};const node=()=>({innerHTML:'',textContent:'',classList:{toggle(){}},addEventListener(){}});
 const main=()=>{const n=node();Object.defineProperty(n,'innerHTML',{set(value){this.html=value;for(const id of ['pcs25Kpis','pcs25Clients','pcs25Bookings','pcs25Attention'])nodes[id]=node()},get(){return this.html||''}});return n;};
 nodes.root={set innerHTML(v){nodes.main=main()}};
 const document={body:{classList:{remove(){},add(){}}},getElementById:id=>nodes[id],querySelector:()=>null};
 const window={PCS:{page:'dashboard'},shell:()=>'',go(){},call:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))};
 vm.runInNewContext(readFileSync(new URL('../dashboard-v25.js',import.meta.url),'utf8'),{window,document,localStorage:{pcsToken:'test'},setTimeout:()=>0,setInterval:()=>0,clearInterval(){},Intl,Date,Promise});
 return{window,nodes,pending};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const payload=()=>({sections:{crm:{data:{contacts:1005,clients:[{id:'safe-id',name:'<script>bad</script>',need:'Need',priority:'NORMAL'}],tasks:{open:10,overdue:2,undated:1},approvals:0,delivery_unknown:0}},business:{data:{active_bookings:4,catalog:900,available:800,catalog_review:1,bookings:[],unread_notifications:0,sla_overdue:0,human_review:0,execution_issues:0}},runtime:{data:{unresolved_jobs:0}}}});
test('dashboard uses authoritative counts rather than preview lengths and escapes contact text',async()=>{
 const h=fixture();h.window.pcsDashboard25();assert.equal(h.pending[0].url,'/dashboard');h.pending[0].resolve(payload());await tick();
 assert.match(h.nodes.pcs25Kpis.innerHTML,/1005/);assert.match(h.nodes.pcs25Kpis.innerHTML,/900/);assert.doesNotMatch(h.nodes.pcs25Clients.innerHTML,/<script>/);assert.match(h.nodes.pcs25Clients.innerHTML,/&lt;script&gt;/);assert.match(h.nodes.pcs25Attention.innerHTML,/Просрочены: 2/);
});
test('failed dashboard sections display unavailable counts and visible errors instead of false zero',async()=>{
 const h=fixture();h.window.pcsDashboard25();const d=payload();d.sections.business={error:'<database unavailable>'};h.pending[0].resolve(d);await tick();
 assert.match(h.nodes.pcs25Kpis.innerHTML,/источник недоступен/);assert.match(h.nodes.pcs25Bookings.innerHTML,/&lt;database unavailable&gt;/);assert.match(h.nodes.pcs25Attention.innerHTML,/&lt;database unavailable&gt;/);
});
test('dashboard responses cannot overwrite another screen or a newer dashboard',async()=>{
 const h=fixture();h.window.pcsDashboard25();const old=h.nodes.pcs25Kpis;h.window.PCS.page='crm';h.pending[0].resolve(payload());await tick();assert.equal(old.innerHTML,'');
 h.window.PCS.page='dashboard';h.window.pcsDashboard25();h.window.pcsDashboard25();h.pending[2].resolve(payload());await tick();const current=h.nodes.pcs25Kpis;h.pending[1].reject(Error('stale'));await tick();assert.match(current.innerHTML,/1005/);assert.doesNotMatch(current.innerHTML,/stale/);
});
