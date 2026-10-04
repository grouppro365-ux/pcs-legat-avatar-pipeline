import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/errors.js',import.meta.url),'utf8');
function fixture({fail=false}={}){
 const nodes={'#main':{},'#errList':{}};const requests=[];
 const esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const window={go:()=>{}};
 const fetch=async(url,init)=>{requests.push({url,init});if(fail)return Response.json({error:'Queue unavailable'},{status:503});const source=new URL(url).searchParams.get('source');return Response.json({source,rows:[{id:'attempt1',contact_id:'client1',contact_name:'<Client>',operation:source==='delivery'?'crm_manual':'telegram_update',error:'<Failure>',status:'review_required',created_at:'2026-10-04T00:00:00Z'}],truncated:true})};
 vm.runInNewContext(source,{window,fetch,localStorage:{pcsToken:'fixture'},document:{querySelector:s=>nodes[s]},esc,URL,Intl,Date,PCS:{},shell:()=>'',toast:()=>{}});
 return{api:window,nodes,requests};
}
test('error page reads the worker queue without promising or triggering a retry',async()=>{
 const f=fixture();await f.api.errorsPage();assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/source=runtime/);assert.equal(f.requests[0].init.headers.authorization,'Bearer fixture');assert.match(f.nodes['#errList'].innerHTML,/Требует проверки/);assert.match(f.nodes['#errList'].innerHTML,/&lt;Failure&gt;/);assert.doesNotMatch(f.nodes['#errList'].innerHTML,/retryFailedJob/);
});
test('delivery tab links the actual Neon client and paginates without sending messages',async()=>{
 const f=fixture();await f.api.errorsPage('delivery',2);assert.match(f.requests[0].url,/page=2/);assert.match(f.nodes['#errList'].innerHTML,/Диалог клиента/);assert.match(f.nodes['#errList'].innerHTML,/Страница 3/);assert.match(f.nodes['#errList'].innerHTML,/Доставка не подтверждена/);assert.equal(f.requests[0].init.method,undefined);
});
test('errors remain visible and invalid page selection makes no request',async()=>{
 const f=fixture({fail:true});await f.api.errorsPage('delivery',-1);assert.equal(f.requests.length,0);await f.api.errorsPage();assert.equal(f.nodes['#errList'].textContent,'Queue unavailable');
});
