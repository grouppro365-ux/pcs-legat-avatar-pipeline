import test from 'node:test';
import assert from 'node:assert/strict';
import {attributionFilters,readAttributionReport,attributionBusinessQuery} from './attribution-report.mjs';
const contact='11111111-1111-4111-8111-111111111111',placement='22222222-2222-4222-8222-222222222222';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('date windows are inclusive UTC, leap dates validated, bounded and parameterized',()=>{
 assert.deepEqual(attributionFilters({from:'2024-02-29',to:'2024-03-01',page:'2'}),{from:'2024-02-29',to:'2024-03-01',start:'2024-02-29T00:00:00.000Z',end:'2024-03-02T00:00:00.000Z',page:2});
 for(const input of [{to:'bad'},{from:'2026-02-29',to:'2026-03-01'},{from:'2024-01-01',to:'2026-01-01'},{page:'1;select'},{page:1001}])assert.throws(()=>attributionFilters(input),e=>e.status===400);
});
test('exact canonical source binding preserves decimal money and separates currencies',async()=>{
 const calls=[];
 const biz={query:async(sql,args)=>{assert.equal(sql,attributionBusinessQuery);assert.deepEqual(args,[[contact],'2026-10-01T00:00:00.000Z','2026-10-17T00:00:00.000Z']);return [{source_contact_id:contact,profile_count:1,applications:2,verified_gross_thb:'9007199254740993.12',expected_commissions:[{currency:'USD',expected_amount:'13.40',records:1},{currency:'THB',expected_amount:'10.00',records:1}]}];}};
 const fetcher=async url=>{const u=new URL(url);calls.push(u);if(u.pathname.endsWith('pcs_client_attribution'))return response([{contact_id:contact,placement_id:placement,attributed_at:'2026-10-05'}]);if(u.pathname.endsWith('pcs_acquisition_events'))return response([]);if(u.pathname.endsWith('pcs_ad_placements'))return response([{id:placement,source_title:'Actual source'}]);throw Error('unexpected');};
 const r=await readAttributionReport(biz,'https://example.test','secret',{from:'2026-10-01',to:'2026-10-16'},fetcher);
 assert.equal(r.rows[0].business.verified_gross_thb,'9007199254740993.12');assert.equal(r.rows[0].business.expected_commissions.length,2);assert.equal(r.rows[0].source_title,'Actual source');assert.equal(r.semantics.scope,'page_cohort');assert.deepEqual(r.unavailable,[]);assert.equal(calls[0].searchParams.get('and'),'(attributed_at.gte.2026-10-01T00:00:00.000Z,attributed_at.lt.2026-10-17T00:00:00.000Z)');
});
test('one unavailable source does not hide another or invent zero financial results',async()=>{
 const r=await readAttributionReport({query:async()=>{throw Error('db');}},'https://example.test','secret',{from:'2026-10-01',to:'2026-10-16'},async url=>String(url).includes('pcs_client_attribution')?response([{contact_id:contact}]):response({},503));
 assert.deepEqual(r.unavailable,['acquisition_events','canonical_business']);assert.equal(r.rows[0].business,null);assert.deepEqual(r.events,[]);
});
test('pagination exposes 101st row independently and never counts it as cohort',async()=>{
 let canonicalIds;
 const r=await readAttributionReport({query:async(_sql,args)=>{canonicalIds=args[0];return [];}},'https://example.test','secret',{page:'3'},async url=>{const u=new URL(url);assert.equal(u.searchParams.get('offset'),'300');return u.pathname.endsWith('pcs_client_attribution')?response(Array.from({length:101},()=>({contact_id:contact}))):response([]);});
 assert.equal(r.rows.length,100);assert.deepEqual(canonicalIds,[contact]);assert.deepEqual(r.truncated,{attribution:true,acquisition_events:false});
});
test('ambiguous canonical profiles do not expose inferred ownership',async()=>{
 const r=await readAttributionReport({query:async()=>[{source_contact_id:contact,profile_count:2,applications:0,verified_gross_thb:'0',expected_commissions:[]}]},'https://example.test','secret',{},async url=>response(String(url).includes('pcs_client_attribution')?[{contact_id:contact}]:[]));
 assert.equal(r.rows[0].business.profile_count,2);assert.equal(r.rows[0].business.applications,0);
});
