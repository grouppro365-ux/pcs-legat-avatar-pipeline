import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const tick=()=>new Promise(setImmediate);
function fixture(applications=[]){
 const nodes=Object.fromEntries(['notice','account','accountStatus','role','request','applications','refresh','logout','accountForm','accountSignup','accountBind','accountEmail','accountPassword','accountName'].map(id=>[id,{textContent:'',innerHTML:'',value:'',hidden:false,querySelectorAll:()=>[],reportValidity:()=>true}]));
 nodes.accountEmail.value='qa@example.invalid';nodes.accountPassword.value='test-password';nodes.accountName.value='QA';
 const storage=new Map(),calls=[];let loginError=false,signouts=0;
 const auth={getSession:async()=>({data:null}),token:async()=>({data:{token:'verified-jwt'}}),signIn:{email:async()=>loginError?{error:{message:'Неверный пароль'}}:{data:{user:{id:'qa'}}}},signUp:{email:async()=>({data:{user:{id:'qa'}}})},signOut:async()=>{signouts++;return {data:{success:true}}}};
 const home={role:'CLIENT',expires_at:'2027-10-11',applications,offers:[],payments:[]};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/cabinet.js',import.meta.url),'utf8'),{window:{PCSCabinetAuth:auth},location:{hash:'#'+'a'.repeat(64),pathname:'/cabinet'},history:{replaceState(){}},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},document:{getElementById:id=>nodes[id],addEventListener(){},querySelectorAll:()=>[]},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='POST'?{ok:true}:home}},crypto,FormData});
 return {nodes,calls,storage,failLogin(){loginError=true},get signouts(){return signouts}};
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
