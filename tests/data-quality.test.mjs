import test from 'node:test';
import assert from 'node:assert/strict';
import {dataQualityQuery,readDataQuality} from '../server/supabase/pcs-manager-live2/data-quality.mjs';
test('quality filters reject SQL input and invalid pages before querying',async()=>{
 const db={query:()=>assert.fail('database called')};
 for(const [view,page] of [["phone' OR true --",'0'],['phone','-1'],['phone','5001'],['phone','1.1'],['phone',1]])await assert.rejects(()=>readDataQuality(db,view,page));
});
test('quality lookahead binds bounded pagination and returns only 50 records',async()=>{
 const rows=Array.from({length:51},(_,i)=>({id:'qa-'+i}));
 const d=await readDataQuality({query:async(q,p)=>{assert.deepEqual(p,[100]);assert.match(q,/limit 51 offset \$1/);return rows}},'phone','2');
 assert.equal(d.rows.length,50);assert.equal(d.truncated,true);assert.equal(d.page,2);assert.equal(d.view,'phone');
});
test('duplicate candidates conservatively normalize formatting and exclude unknown identities',()=>{
 assert.match(dataQualityQuery('telegram').query,/telegram_user_id>0/);
 const q=dataQualityQuery('phone').query;assert.ok(q.includes("'^\\+?[0-9]{7,15}$'"));assert.ok(q.includes('[[:space:]().-]'));assert.match(q,/duplicate_count>1/);
 for(const view of ['telegram','phone','overdue','missing_date']){
  const q=dataQualityQuery(view).query;assert.doesNotMatch(q,/\b(insert|update|delete|merge)\b/i);assert.doesNotMatch(q,/raw|message|password|secret/i);
 }
});
test('followup checks exclude terminal clients and distinguish overdue dates from missing dates',()=>{
 for(const v of ['overdue','missing_date'])assert.match(dataQualityQuery(v).query,/not in \('COMPLETED','LOST','SPAM'\)/);
 assert.match(dataQualityQuery('overdue').query,/next_action_at<\(now\(\) at time zone 'UTC'\)/);
 assert.ok(dataQualityQuery('missing_date').query.includes("nullif(btrim(next_action),'') is not null"));
 assert.match(dataQualityQuery('missing_date').query,/next_action_at is null/);
});
