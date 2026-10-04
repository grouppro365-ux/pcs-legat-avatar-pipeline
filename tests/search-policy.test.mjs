import test from 'node:test';
import assert from 'node:assert/strict';
import {globalSearch,searchQueries} from '../server/supabase/pcs-manager-live2/search-policy.mjs';
test('search binds literal hostile query, database identity, bounded offset and lookahead',async()=>{
 const calls=[],op={query:async(q,p)=>{calls.push({db:'op',q,p});return Array.from({length:21},(_,i)=>({id:String(i)}))}},biz={query:async(q,p)=>{calls.push({db:'biz',q,p});return[]}};
 const input="%' OR 1=1 --",data=await globalSearch(op,biz,input,'all','3');assert.equal(calls.length,5);assert.deepEqual(calls.map(x=>x.db),['op','biz','biz','biz','op']);
 for(const x of calls){assert.deepEqual(x.p,[input,60]);assert.ok(!x.q.includes(input));assert.match(x.q,/limit 21 offset \$2/);assert.match(x.q,/strpos/)}
 assert.equal(data.groups[0].rows.length,20);assert.equal(data.groups[0].truncated,true);
});
test('failed source is visible while independent results survive and private error does not leak',async()=>{
 const op={query:async()=>[{id:'real'}]},biz={query:async()=>{throw Error('postgres://private')}};
 const data=await globalSearch(op,biz,'test');assert.equal(data.groups[0].rows[0].id,'real');assert.ok(data.groups[1].error);assert.ok(!JSON.stringify(data).includes('postgres'));
});
test('invalid input is rejected before any database access',async()=>{
 const db={query:()=>assert.fail('database called')};for(const [q,s,p] of [['x','all','0'],['x'.repeat(121),'all','0'],['ok','deals','0'],['ok','all','-1'],['ok','all','5001']])await assert.rejects(()=>globalSearch(db,db,q,s,p));
});
test('search returns explicit fields without raw records or internal pricing',()=>{for(const q of Object.values(searchQueries)){assert.ok(!q.includes('select *'));assert.ok(!q.includes('internal_net'));assert.ok(!q.includes('raw'))}});
