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
test('follow-up refuses missing or unreadable internal credentials before touching the queue',async()=>{
  const source=readFileSync(new URL('../../supabase/functions/pcs-customer-followup-v1/index.ts',import.meta.url),'utf8');
  const handlerSource=source.slice(source.lastIndexOf('Deno.serve('));
  for(const mode of ['missing','unreadable','mismatch','valid']){
    let handler;let queueReads=0;
    const query={select(){return this},eq(){return this},lte(){return this},order(){return this},async limit(){return {data:[],error:null}}};
    vm.runInNewContext(handlerSource,{
      Deno:{serve(fn){handler=fn}},
      sec:async()=>{if(mode==='unreadable')throw Error('unavailable');return mode==='missing'?'':'internal-test-key'},
      sb:{from(){queueReads++;return query}},
      J:(body,status=200)=>({body,status}),processOne:async()=>{throw Error('must not send')}
    });
    const result=await handler({method:'POST',headers:{get:()=>mode==='valid'?'internal-test-key':'wrong-key'}});
    assert.equal(result.status,mode==='valid'?200:403,mode);
    assert.equal(queueReads,mode==='valid'?1:0,mode);
  }
});
