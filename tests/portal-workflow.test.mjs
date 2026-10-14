import test from 'node:test';
import assert from 'node:assert/strict';
import {portalCommand,tokenHash,portalRoute,portalDatabaseError,adminWorkflow} from '../server/supabase/pcs-manager-live2/portal-workflow.mjs';
import {inboxPage,unifiedInbox} from '../server/supabase/pcs-manager-live2/unified-inbox.mjs';
const id='00000000-0000-4000-8000-000000000001';
test('portal commands cannot inject another profile, role or admin action',()=>{
 const base={action:'confirm',request_id:id,payload:{application_id:id,expected_version:'2026-10-11 01:01:01'}};
 assert.equal(portalCommand(base),base);
 for(const payload of [{...base.payload,client_profile_id:id},{...base.payload,role:'admin'}])assert.throws(()=>portalCommand({...base,payload}));
 assert.throws(()=>portalCommand({...base,action:'review-payment'}));
});
test('portal token is hashed before database access and admin token is rejected',async()=>{
 const token='a'.repeat(64);let params;
 const biz={query:async(q,p)=>{params=p;return[{result:{role:'CLIENT'}}]}};
 assert.deepEqual(await portalRoute(new Request('https://test',{headers:{authorization:'Bearer '+token}}),biz),{role:'CLIENT'});
 assert.equal(params[0],await tokenHash(token));assert.notEqual(params[0],token);
 await assert.rejects(portalRoute(new Request('https://test',{headers:{authorization:'Bearer admin.signature'}}),biz));
});
test('personal link secret is returned once and only its hash is persisted',async()=>{
 let payload;const biz={query:async(q,p)=>{payload=JSON.parse(p[1]);return[{result:{ok:true,access_id:id}}]}};
 const r=await adminWorkflow(biz,{action:'issue-access',role:'CLIENT',profile_id:id});
 const token=r.url.split('#')[1];assert.match(token,/^[a-f0-9]{64}$/);assert.equal(payload.hash,await tokenHash(token));assert.ok(!JSON.stringify(payload).includes(token));
});
test('unified inbox reports unavailable source and does not blend identities',async()=>{
 const op={query:async()=>[{id:'same',name:'N',last_contact_at:'2026-01-01'}]};
 const fetcher=async()=>new Response(JSON.stringify([{id:'same',name:'N',preferred_channel:'line',last_contact_at:'2026-01-02'}]));
 const r=await unifiedInbox(op,'https://test','secret','0',fetcher);assert.equal(r.rows.length,2);assert.deepEqual(r.rows.map(x=>x.source),['runtime','operator']);
 const partial=await unifiedInbox(op,'https://test','secret','0',async()=>{throw Error('outage')});assert.deepEqual(partial.unavailable,['runtime']);assert.equal(partial.rows.length,1);
 assert.throws(()=>inboxPage('-1'));assert.throws(()=>inboxPage('1001'));
});
test('portal errors expose a safe conflict and deny forbidden access',()=>{
 assert.equal(portalDatabaseError({message:'portal_access_denied',code:'42501'}).status,403);
 assert.equal(portalDatabaseError({message:'portal_version_conflict',code:'40001'}).status,409);
 assert.equal(portalDatabaseError({message:'database unavailable'}),null);
});
test('vehicle offer requires explicit vehicle and both rental dates without accepting another profile',()=>{
 const base={action:'submit-offer',request_id:id,payload:{application_id:id,expected_version:'version',price:'1000',deposit:'200',terms:'Rental'}};
 assert.equal(portalCommand(base),base);
 const rental={...base,payload:{...base.payload,catalog_item_id:id,start_date:'2112-01-10',end_date:'2112-01-15'}};
 assert.equal(portalCommand(rental),rental);
 for(const extra of [{start_date:'2112-01-10'},{catalog_item_id:id},{catalog_item_id:'bad',start_date:'2112-01-10',end_date:'2112-01-15'},{...rental.payload,partner_id:id}])assert.throws(()=>portalCommand({...base,payload:{...base.payload,...extra}}));
 assert.equal(portalDatabaseError({message:'vehicle_offer_dates_invalid',code:'22023'}).status,400);
});
test('service phase requires an explicit human confirmation and stable request identity',async()=>{
 const b={action:'service-phase',application_id:id,expected_version:'version',phase:'STARTED',request_id:id,confirmed:'true',note:'Checked the actual service start'};
 let payload;const db={query:async(q,p)=>{payload=JSON.parse(p[1]);return[{result:{ok:true}}];}};
 assert.deepEqual(await adminWorkflow(db,b),{ok:true});assert.equal(payload.request_id,id);
 for(const changes of [{phase:'OTHER'},{confirmed:'false'},{note:'short'},{request_id:'bad'},{client_profile_id:id}])await assert.rejects(()=>adminWorkflow({query:()=>assert.fail('invalid write')},{...b,...changes}));
 assert.throws(()=>portalCommand({action:'service-phase',request_id:id,payload:{application_id:id,expected_version:'version'}}));
});
