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
test('content search is denied before database access without current content.view and remains absent from legacy all search',async()=>{
 let calls=0;const db={query:async q=>{calls++;assert.doesNotMatch(q,/pcs\.content_/);return[]}};
 for(const permissions of [undefined,[],['content.edit'],['clients.manage'],{permissions:['*']}])await assert.rejects(()=>globalSearch(db,db,'draft','content','0',permissions),e=>e.status===403);
 assert.equal(calls,0);const data=await globalSearch(db,db,'draft','all','0',['content.edit']);assert.equal(calls,5);assert.equal(data.groups.some(g=>g.scope==='content'),false);
});
test('authorized content search binds literal query and latest canonical revision, brand, platform and language with bounded lookahead',async()=>{
 const input="%' OR 1=1 --",queries=[],op={query:()=>assert.fail('content used operational database')},biz={query:async(q,p)=>{queries.push([q,p]);return Array.from({length:21},(_,i)=>({id:'post-'+i,title:'Draft',brand_name:'PCS',platform:'telegram',language:'ru',status:'REVIEW',summary:'Current content'}));}};
 const out=await globalSearch(op,biz,input,'content','2',['content.view']);assert.equal(queries.length,1);assert.deepEqual(queries[0][1],[input,40]);assert.equal(queries[0][0].includes(input),false);assert.match(queries[0][0],/from pcs\.content_posts p join pcs\.content_brands/);assert.match(queries[0][0],/post_id=p.id order by revision desc limit 1/);assert.match(queries[0][0],/left\(r.body,200\)/);assert.match(queries[0][0],/r.title,r.body,b.name,r.platform,r.language/);assert.match(queries[0][0],/order by p.updated_at desc,p.id limit 21 offset \$2/);assert.doesNotMatch(queries[0][0],/source_facts|brand_guidelines|secret|token|select \*/);
 assert.equal(out.groups[0].scope,'content');assert.equal(out.groups[0].rows.length,20);assert.equal(out.groups[0].truncated,true);
});
test('admin all search includes content while an unavailable content source cannot erase other groups or expose database errors',async()=>{
 const calls=[],op={query:async(q,p)=>{calls.push(q);return[{id:'real-contact'}]}},biz={query:async(q,p)=>{calls.push(q);if(q.includes('pcs.content_posts'))throw Error('postgres://private-content');return[]}};
 const out=await globalSearch(op,biz,'topic','all','0',['*']);assert.equal(calls.length,6);assert.equal(out.groups.find(g=>g.scope==='contacts').rows[0].id,'real-contact');assert.ok(out.groups.find(g=>g.scope==='content').error);assert.equal(JSON.stringify(out).includes('postgres://'),false);
});
