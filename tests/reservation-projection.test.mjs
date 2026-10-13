import test from 'node:test';
import assert from 'node:assert/strict';
import {projectionDecision,syncReservationProjections,projectionLeaseQuery,projectionFinishQuery,projectionApplicationsQuery,projectionReviewQuery} from '../server/supabase/pcs-manager-live2/reservation-projection.mjs';
const id='11111111-1111-4111-8111-111111111111',car='22222222-2222-4222-8222-222222222222';
const row={id,source:'neon_contract_projection',catalog_item_id:car,start_date:'2113-01-10',end_date:'2113-01-12',status:'confirmed',updated_at:'2026-10-13T23:00:00.123456+00:00'};
const app={id,item_id:car,category:'booking',start_date:row.start_date,end_date:row.end_date,operational_status:'CANCELLED_BY_CLIENT',edit_version:'version'};
const fixture=(rows=[row],apps=[app],options={})=>{
 const queries=[],calls=[];
 const biz={query:async(q,p)=>{queries.push({q,p});if(q===projectionLeaseQuery)return options.busy?[]:[{cursor:options.cursor||null}];if(q===projectionApplicationsQuery)return apps;if(q===projectionFinishQuery)return options.lost?[]:[{key:'reservation_projection_sync'}];if(q===projectionReviewQuery)return[];throw Error('unexpected SQL');}};
 const transport=async(url,o={})=>{calls.push({url:new URL(url),o});if(o.method==='PATCH')return new Response(JSON.stringify(options.conflict?[]:[{id:JSON.parse(o.body)?new URL(url).searchParams.get('id').slice(3):''}]),{status:options.fail?500:200});return new Response(JSON.stringify(rows));};
 return {biz,transport,queries,calls};
};
test('projection maps verified canonical phases without touching unrelated reservations',()=>{
 for(const [phase,status] of Object.entries({NEW:'requested',AWAITING_PARTNER_CONFIRMATION:'hold',CONFIRMED:'confirmed',SERVICE_IN_PROGRESS:'active',COMPLETED:'completed',CANCELLED_BY_CLIENT:'cancelled',CANCELLED_BY_PARTNER:'cancelled',FAILED:'cancelled'}))assert.deepEqual(projectionDecision(row,{...app,operational_status:phase}),{status,changed:status!==row.status});
 for(const invalid of [{...app,item_id:id},{...app,start_date:'2113-01-11'},{...app,category:'general'},{...app,id:car}])assert.equal(projectionDecision(row,invalid).review,'booking_terms_diverged');
 assert.equal(projectionDecision(row,null).review,'canonical_booking_missing');assert.equal(projectionDecision({...row,source:'manual'},app).review,'projection_identity_invalid');
 for(const phase of ['UNKNOWN','constructor','__proto__'])assert.equal(projectionDecision(row,{...app,operational_status:phase}).review,'canonical_status_unknown');
});
test('worker only patches status with full identity and old-row CAS; preserves money/contact fields',async()=>{
 const f=fixture();const r=await syncReservationProjections(f.biz,'https://test','test-key',f.transport);assert.equal(r.updated,1);assert.equal(r.ok,true);
 const patch=f.calls.find(c=>c.o.method==='PATCH');assert.deepEqual(Object.keys(JSON.parse(patch.o.body)).sort(),['status','updated_at']);assert.equal(JSON.parse(patch.o.body).status,'cancelled');
 for(const [k,v] of Object.entries({id,source:'neon_contract_projection',status:row.status,updated_at:row.updated_at,catalog_item_id:car,start_date:row.start_date,end_date:row.end_date}))assert.equal(patch.url.searchParams.get(k),'eq.'+v);
 assert.equal(f.calls[0].url.searchParams.get('limit'),'51');assert.deepEqual(f.queries.find(q=>q.q===projectionApplicationsQuery).p,[[id]]);
 assert.equal(f.queries.at(-1).q,projectionFinishQuery);assert.equal(f.queries.at(-1).p[1],null);
});
test('concurrent projection change is never overwritten, stable status causes no patch',async()=>{
 let f=fixture([row],[app],{conflict:true});let r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.updated,0);assert.equal(r.conflicts,1);
 f=fixture([row],[{...app,operational_status:'CONFIRMED'}]);r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.unchanged,1);assert.equal(f.calls.length,1);
});
test('diverged terms create an operator review with dedupe, do not patch the reservation',async()=>{
 const f=fixture([row],[{...app,end_date:'2113-01-13'}]);const r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.review_required,1);assert.equal(f.calls.length,1);assert.deepEqual(f.queries.find(q=>q.q===projectionReviewQuery).p,[id,'booking_terms_diverged','version']);
});
test('busy lease has no external request; uncertain write preserves cursor for retry',async()=>{
 let f=fixture([row],[app],{busy:true});let r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.skipped,'lease_busy');assert.equal(f.calls.length,0);
 f=fixture([row],[app],{fail:true});r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.ok,false);assert.equal(r.lease_pending,true);assert.ok(!f.queries.some(q=>q.q===projectionFinishQuery));
});
test('bounded keyset page continues past 50 without starving later reservations',async()=>{
 const rows=Array.from({length:51},(_,n)=>({...row,id:'11111111-1111-4111-8111-'+String(n).padStart(12,'0')}));const apps=rows.map(r=>({...app,id:r.id,operational_status:'CONFIRMED'}));const cursor='00000000-0000-4000-8000-000000000001';const f=fixture(rows,apps,{cursor});const r=await syncReservationProjections(f.biz,'https://test','k',f.transport);assert.equal(r.scanned,50);assert.equal(f.calls[0].url.searchParams.get('id'),'gt.'+cursor);assert.equal(f.queries.at(-1).p[1],rows[49].id);
});
