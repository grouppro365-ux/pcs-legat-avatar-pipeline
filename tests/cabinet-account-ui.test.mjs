import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const tick=()=>new Promise(setImmediate);
function fixture(applications=[],settings={}){
 const nodes=Object.fromEntries(['notice','account','accountStatus','role','request','applications','refresh','logout','accountForm','accountSignup','accountBind','accountEmail','accountPassword','accountName'].map(id=>[id,{textContent:'',innerHTML:'',value:'',hidden:false,querySelectorAll:()=>[],reportValidity:()=>true}]));
 nodes.accountEmail.value='qa@example.invalid';nodes.accountPassword.value='test-password';nodes.accountName.value='QA';
 const storage=new Map(),calls=[],events={};let loginError=false,signouts=0;
 const auth={getSession:async()=>({data:null}),token:async()=>({data:{token:'verified-jwt'}}),signIn:{email:async()=>loginError?{error:{message:'Неверный пароль'}}:{data:{user:{id:'qa'}}}},signUp:{email:async()=>({data:{user:{id:'qa'}}})},signOut:async()=>{signouts++;return {data:{success:true}}}};
 const home={role:'CLIENT',expires_at:'2027-10-11',applications,offers:[],payments:[],has_more:settings.hasMore||false};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/cabinet.js',import.meta.url),'utf8'),{window:{PCSCabinetAuth:auth},location:{hash:'#'+'a'.repeat(64),pathname:'/cabinet'},history:{replaceState(){}},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},document:{getElementById:id=>nodes[id],addEventListener:(name,fn)=>events[name]=fn,querySelectorAll:()=>[]},fetch:async(url,options)=>{calls.push({url,options});if(settings.transport)return settings.transport(url,options,home);return {ok:true,json:async()=>options.method==='POST'?{ok:true}:home}},crypto,FormData,URL});
 return {nodes,calls,storage,events,home,failLogin(){loginError=true},get signouts(){return signouts}};
}
test('account login binds the invitation once, clears its stored capability, and uses managed JWT for the cabinet',async()=>{
 const f=fixture();await tick();f.nodes.accountForm.onsubmit({preventDefault(){}});await tick();await tick();
 const bind=f.calls.find(x=>x.options.method==='POST');assert.match(bind.url,/portal-account/);assert.equal(bind.options.headers.authorization,'Bearer verified-jwt');assert.equal(JSON.parse(bind.options.body).invitation,'a'.repeat(64));assert.equal(f.storage.has('pcsCabinetToken'),false);assert.equal(f.nodes.account.hidden,true);assert.equal(f.nodes.accountPassword.value,'');
});
test('login errors stay visible and never consume the invitation',async()=>{
 const f=fixture();await tick();f.failLogin();f.nodes.accountForm.onsubmit({preventDefault(){}});await tick();assert.match(f.nodes.accountStatus.textContent,/Неверный пароль/);assert.equal(f.storage.has('pcsCabinetToken'),true);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
});
test('logout clears private content and the local capability and ends the managed session',async()=>{
 const f=fixture();await tick();await f.nodes.logout.onclick();assert.equal(f.signouts,1);assert.equal(f.nodes.applications.textContent,'');assert.equal(f.nodes.request.textContent,'');assert.equal(f.storage.has('pcsCabinetToken'),false);assert.equal(f.nodes.account.hidden,false);
});

test('cabinet shows canonical full balances without treating pending money or deposits as credit',async()=>{
 const f=fixture([{id:'qa',public_id:'QA',operational_status:'COMPLETED',client_payment_status:'PAID_TO_PARTNER',payment_balance:{verified_amount:'500.15',pending_amount:'500.10',remaining:'500.10',deposit:'2000',balance_status:'PARTIAL'}}]);await tick();
 const html=f.nodes.applications.innerHTML;assert.match(html,/Проверено поступление за услугу: 500.15 THB/);assert.match(html,/Переводы на проверке: 500.10 THB/);assert.match(html,/Остаток оплаты услуги: 500.10 THB/);assert.match(html,/депозит считается отдельно/);
});
test('cabinet exposes reconciliation uncertainty and escapes database text',async()=>{
 const f=fixture([{id:'qa',public_id:'QA',payment_balance:{balance_status:'OVERPAID',verified_amount:'<script>bad</script>',pending_amount:'0',remaining:'0',overpayment:'4.90'}},{id:'unknown',public_id:'UNKNOWN',payment_balance:{balance_status:'UNKNOWN',remaining:null}}]);await tick();const html=f.nodes.applications.innerHTML;
 assert.match(html,/превышает стоимость на 4.90 THB/);assert.match(html,/Остаток оплаты уточнит оператор/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});

test('cabinet navigation loads an older page and keeps the current page on a failed load',async()=>{
 let fail=false;const f=fixture([],{hasMore:true,transport:async(url,opt,home)=>({ok:!fail,json:async()=>fail?{error:'Temporary read failure'}:home})});await tick();
 assert.match(f.nodes.applications.innerHTML,/data-cabinet-page="1"/);assert.equal(new URL(f.calls[0].url).searchParams.get('page'),'0');
 const click=n=>f.events.click({target:{closest:selector=>selector==='button[data-cabinet-page]'?{dataset:{cabinetPage:String(n)}}:null}});
 click(1);await tick();assert.equal(new URL(f.calls.at(-1).url).searchParams.get('page'),'1');assert.match(f.nodes.applications.innerHTML,/Страница 2/);assert.match(f.nodes.applications.innerHTML,/data-cabinet-page="0"/);
 fail=true;click(2);await tick();assert.match(f.nodes.notice.textContent,/Temporary read failure/);assert.match(f.nodes.applications.innerHTML,/Страница 2/);
});
test('a late older-page response cannot replace a newer refresh',async()=>{
 const pending=[];let defer=false;const f=fixture([],{hasMore:true,transport:async(url,opt,home)=>defer?new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>home}))):({ok:true,json:async()=>home})});await tick();defer=true;
 f.events.click({target:{closest:selector=>selector==='button[data-cabinet-page]'?{dataset:{cabinetPage:'1'}}:null}});f.nodes.refresh.onclick();assert.equal(pending.length,2);
 pending[1]();await tick();assert.match(f.nodes.applications.innerHTML,/Страница 1/);pending[0]();await tick();assert.match(f.nodes.applications.innerHTML,/Страница 1/);
});

test('application history reads older pages, escapes references and retains records after a failed read',async()=>{
 const id='00000000-0000-4000-8000-000000000001';let fail=false;
 const f=fixture([{id,public_id:'QA'}],{transport:async(url,opt,home)=>{const p=new URL(url).searchParams;return {ok:!fail,json:async()=>fail?{error:'History temporarily unavailable'}:p.has('history')?{page:Number(p.get('page')),rows:[{id:'claim',amount_thb:'10.25',status:'VERIFIED',reference:'<script>reference</script>',created_at:'2026-10-15'}],has_more:true}:home};}});await tick();
 const panel=f.nodes['pcsHistory-'+id]={innerHTML:'',textContent:''};
 const click=page=>f.events.click({target:{closest:s=>s==='button[data-cabinet-history]'?{dataset:{app:id,cabinetHistory:'payments',historyPage:String(page)}}:null}});
 click(5);await tick();const params=new URL(f.calls.at(-1).url).searchParams;assert.equal(params.get('application_id'),id);assert.equal(params.get('history'),'payments');assert.equal(params.get('page'),'5');assert.equal(params.has('q'),false);assert.match(panel.innerHTML,/страница 6/);assert.match(panel.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(panel.innerHTML,/<script>/);
 fail=true;click(6);await tick();assert.match(panel.innerHTML,/10.25/);assert.match(panel.innerHTML,/History temporarily unavailable/);
});
test('late history response is discarded after account logout',async()=>{
 const id='00000000-0000-4000-8000-000000000001';let finish;
 const f=fixture([{id,public_id:'QA'}],{transport:async(url,opt,home)=>new URL(url).searchParams.has('history')?new Promise(resolve=>finish=()=>resolve({ok:true,json:async()=>({page:0,rows:[],has_more:false})})):({ok:true,json:async()=>home})});await tick();const panel=f.nodes['pcsHistory-'+id]={innerHTML:'',textContent:''};
 f.events.click({target:{closest:s=>s==='button[data-cabinet-history]'?{dataset:{app:id,cabinetHistory:'payments'}}:null}});await f.nodes.logout.onclick();finish();await tick();assert.equal(panel.innerHTML,'');assert.equal(f.nodes.applications.textContent,'');
});
