import test from 'node:test';import assert from 'node:assert/strict';
import {accountRoute} from '../server/supabase/pcs-manager-live2/portal-account.mjs';
const id='00000000-0000-4000-8000-000000000001';
const req=body=>new Request('https://test/?op=portal-account',{method:body?'POST':'GET',headers:{authorization:'Bearer jwt','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('invalid managed identity never queries business data',async()=>{
 const db={query:()=>assert.fail('unauthorized query')};
 for(const verify of [async()=>{throw Error('signature')},async()=>({sub:'not-an-id'})])await assert.rejects(accountRoute(req(),db,verify),e=>e.status===401);
});
test('business role is resolved by server mapping, never by JWT role or caller fields',async()=>{
 const queries=[];const db={query:async(sql,args)=>{queries.push([sql,args]);return sql.includes('portal_account_hash')?[{hash:'server-hash'}]:[{result:{role:'CLIENT',applications:[]}}]}};
 const result=await accountRoute(req(),db,async()=>({sub:id,role:'admin'}));assert.equal(result.role,'CLIENT');assert.deepEqual(queries[0][1],[id]);assert.deepEqual(queries[1][1],['server-hash',0,'all','']);
 await assert.rejects(accountRoute(req({action:'bind',invitation:'a'.repeat(64),role:'PARTNER'}),db,async()=>({sub:id})),e=>e.status===400);
});
test('binding sends only verified user identity and hashes to the canonical transaction',async()=>{
 const db={query:async(sql,args)=>{assert.match(sql,/portal_bind_account/);assert.equal(args[0],id);assert.equal(args.length,3);assert.match(args[1],/^[a-f0-9]{64}$/);assert.notEqual(args[1],'a'.repeat(64));assert.notEqual(args[1],args[2]);return [{result:{ok:true}}]}};
 assert.equal((await accountRoute(req({action:'bind',invitation:'a'.repeat(64)}),db,async()=>({sub:id}))).ok,true);
});

test('managed history uses the server-owned access mapping after verified identity lookup',async()=>{
 const calls=[];const db={query:async(q,p)=>{calls.push([q,p]);return q.includes('portal_account_hash')?[{hash:'private-server-hash'}]:[{result:{rows:[]}}]}};
 await accountRoute(new Request('https://test/?op=portal-account&history=offers&application_id='+id+'&page=2',{headers:{authorization:'Bearer jwt'}}),db,async()=>({sub:id,role:'admin'}));
 assert.match(calls[1][0],/portal_application_history/);assert.deepEqual(calls[1][1],['private-server-hash',id,'offers',2]);
});
