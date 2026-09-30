import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('follow-up never offers review, sold, archived or reserved fleet cars',()=>{
  const source=readFileSync(new URL('../../supabase/functions/pcs-customer-followup-v1/index.ts',import.meta.url),'utf8');
  const expression=source.match(/let items=([\s\S]*?);const ids/)[1].replace(/:any\b/g,'');
  const candidates=['available','under_review','sold','archived','reserved'].map((status,i)=>({id:status,status,daily_price:400-i,metadata:{fleet_master:true}}));
  candidates.push({id:'date-conflict',status:'available',daily_price:200,metadata:{fleet_master:true}});
  const selected=vm.runInNewContext(expression,{candidates,blocked:new Set(['date-conflict']),range:{start:'2026-10-03',end:'2026-10-08'}});
  assert.deepEqual(Array.from(selected,x=>x.id),['available']);
  assert.equal(candidates[0].daily_price,400);
});
