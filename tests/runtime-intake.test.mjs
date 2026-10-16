import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeRuntime} from '../server/supabase/pcs-manager-live2/unified-inbox.mjs';
const contact='11111111-1111-4111-8111-111111111111',request='22222222-2222-4222-8222-222222222222',message='33333333-3333-4333-8333-333333333333';
const body={contact_id:contact,request_id:request,need:'  Need a confirmed rental  '};
function fixture(profile,received){const calls=[],reads=[];return {calls,reads,db:{query:async(q,p)=>{calls.push({q,p});return [{application:{id:request,client_profile_id:'canonical'}}]}},fetcher:async(url)=>{reads.push(url);return new Response(JSON.stringify(url.includes('pcs_contacts?')?[{id:contact,name:'Same name',...profile}]:url.includes('raw&')?(received||[]):[]));}};}
test('canonical Meta intake uses persisted ingress identity and ignores same display names and phone',async()=>{
 for(const channel of ['whatsapp','instagram','facebook']){const f=fixture({phone:'shared mutable phone',preferred_channel:'telegram'},[{id:message,channel,raw:{source:'pcs-meta-webhook-v1'}}]);
 assert.equal((await intakeRuntime(f.db,'https://test','key',body,f.fetcher,'managed-user')).application.id,request);
 assert.match(f.calls[0].q,/pcs.runtime_intake/);assert.deepEqual(f.calls[0].p,[contact,request,channel,message,null,null,'Same name','Need a confirmed rental','managed-user']);
 assert.ok(!JSON.stringify(f.calls).includes('shared mutable phone'));}
});
test('Telegram intake preserves trusted provisioner path through atomic intake',async()=>{const f=fixture({telegram_id:12345,username:'display'});await intakeRuntime(f.db,'https://test','key',body,f.fetcher);assert.equal(f.calls[0].p[2],'telegram');assert.equal(f.calls[0].p[4],'12345');assert.equal(f.reads.length,1);});
test('unverified channel records cannot create a canonical profile',async()=>{for(const proof of [[],[{id:message,channel:'whatsapp',raw:{source:'manual'}}],[{id:'bad',channel:'instagram',raw:{source:'pcs-meta-webhook-v1'}}],[{id:message,channel:'line',raw:{source:'pcs-meta-webhook-v1'}}]]){const f=fixture({},proof);await assert.rejects(()=>intakeRuntime(f.db,'https://test','key',body,f.fetcher),e=>e.status===409);assert.equal(f.calls.length,0);}});
test('intake rejects injected profile, account, channel and unsupported fields before any database access',async()=>{for(const extra of [{client_profile_id:contact},{auth_user_id:contact},{channel:'whatsapp'},{need:''},{request_id:'bad'}]){const f=fixture({telegram_id:123});await assert.rejects(()=>intakeRuntime(f.db,'https://test','key',{...body,...extra},f.fetcher),e=>e.status===400);assert.equal(f.reads.length,0);assert.equal(f.calls.length,0);}});
test('canonical identity and replay conflicts are safe and unavailable profiles cannot be reactivated',async()=>{for(const code of ['23505','42501','22023']){const f=fixture({telegram_id:123});f.db.query=async()=>{throw Object.assign(Error('runtime_intake_identity_conflict private database detail'),{code})};await assert.rejects(()=>intakeRuntime(f.db,'https://test','key',body,f.fetcher),e=>e.status===(code==='22023'?400:409)&&!e.message.includes('private'));}});
