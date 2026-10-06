import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applicationOffersQuery,readApplicationOffers} from '../server/supabase/pcs-manager-live2/application-offers.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('offer and quote pages bind application identity and omit internal financial/contact payloads',async()=>{
 for(const source of ['partner','quotes']){const x=applicationOffersQuery(id,source,'2');assert.deepEqual(x.params,[id,100]);assert.match(x.query,/application_id=\$1/);assert.match(x.query,/limit 51 offset \$2/);assert.doesNotMatch(x.query,/select \*|partner_internal_note|commercial_snapshot|internal_breakdown|partner_breakdown|client_contact|public_snapshot/);
 if(source==='partner'){assert.match(x.query,/p.public_name partner_name/);assert.match(x.query,/left join partners p on p.id=o.partner_id/);assert.doesNotMatch(x.query,/legal_name|owner_user_id/);}
 let calls=0;const d=await readApplicationOffers({query:async()=>++calls===1?[{id,public_id:'APP-QA'}]:Array.from({length:51},(_,i)=>({id:String(i)}))},id,source,'2');assert.equal(d.rows.length,50);assert.equal(d.truncated,true);assert.equal(d.source,source);assert.equal(d.page,2);}
});
test('invalid filters and missing application are rejected before offer read',async()=>{
 for(const args of [['bad','partner','0'],[id,'other','0'],[id,'quotes','-1'],[id,'partner','5001']])assert.throws(()=>applicationOffersQuery(...args),e=>e.status===400);
 let calls=0;await assert.rejects(()=>readApplicationOffers({query:async()=>{calls++;return []}},id,'partner','0'),e=>e.status===404);assert.equal(calls,1);
 await assert.rejects(()=>readApplicationOffers({query:async()=>{throw Error('Unavailable')}},id,'quotes','0'),/Unavailable/);
});
test('offer reads stay behind admin auth and do not add quote or acceptance writes',()=>{
 const s=readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8');assert.ok(s.indexOf("if(opName==='application-offers')")>s.indexOf('if(!await verifyAdminToken'));assert.match(s,/application-offers'\)\{if\(req.method!=='GET'/);
});
