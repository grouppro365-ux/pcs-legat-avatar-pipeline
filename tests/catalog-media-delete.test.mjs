import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaDeleteQuery,deleteCatalogMedia} from '../server/supabase/pcs-manager-live2/catalog-media-delete.mjs';
const item_id='11111111-1111-4111-8111-111111111111',ids=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],expected_version='a'.repeat(32);
test('batch delete locks the whole item gallery, validates the version and audits in one query',()=>{
 const q=mediaDeleteQuery({item_id,ids,expected_version});assert.deepEqual(q.params,[item_id,expected_version,ids]);assert.match(q.query,/where m.item_id=\$1::uuid order by m.id for update/);assert.match(q.query,/md5\(coalesce\(jsonb_agg/);assert.match(q.query,/count\(\*\) filter\(where id=any/);assert.match(q.query,/delete from catalog_media m using candidate c where m.item_id=c.item_id/);assert.match(q.query,/insert into audit_events/);assert.match(q.query,/exists\(select 1 from audited\)/);assert.doesNotMatch(q.query,new RegExp(item_id));
});
test('invalid, duplicate and out-of-scope bodies fail before any SQL',async()=>{
 for(const patch of [{ids:[]},{ids:[ids[0],ids[0].toUpperCase()]},{ids:['foreign']},{ids:Array(31).fill(ids[0])},{item_id:'not-uuid'},{expected_version:'old'},{actor_role:'OWNER'},{id:ids[0]}])await assert.rejects(()=>deleteCatalogMedia({query:()=>assert.fail('must not query')},{item_id,ids,expected_version,...patch}),e=>e.status===400);
});
test('stale gallery or foreign photos return conflict instead of partial success',async()=>{
 let calls=0;await assert.rejects(()=>deleteCatalogMedia({query:async()=>{calls++;return[]}},{item_id,ids,expected_version}),e=>e.status===409);assert.equal(calls,1);
});
test('receipt contains the atomically deleted batch and database failures propagate',async()=>{
 const r=await deleteCatalogMedia({query:async()=>[{id:item_id,deleted:ids}]},{item_id,ids,expected_version});assert.deepEqual(r,{ok:true,id:item_id,deleted:ids});await assert.rejects(()=>deleteCatalogMedia({query:async()=>{throw Error('audit failed')}},{item_id,ids,expected_version}),/audit failed/);
});
