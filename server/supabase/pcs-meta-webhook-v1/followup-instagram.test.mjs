import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { carOffersReply, carOfferSnapshot } from './car-rental-response.mjs';

test('real Instagram follow-up uses the durable outbox, never Telegram or a false sent state', async () => {
  const source = readFileSync(new URL('../pcs-customer-followup-v1/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function processOne(');
  const end = source.indexOf('\nDeno.serve(', start);
  assert.ok(start >= 0 && end > start, 'the deployed follow-up handler must be present');
  const handler = stripTypeScriptTypes(source.slice(start, end));
  const pricing = stripTypeScriptTypes(source.slice(source.indexOf('function fmt('), source.indexOf('function intro(')));
  const realPriceLine = new Function('zero', pricing+';return priceLine;')(new Set(['THB']));
  const followup = {id:'followup-1',generation_id:'generation-1',attempts:0,status:'pending'};
  const generation = {id:'generation-1',source_message_id:'source-1',contact_id:'client-1',
    business_connection_id:'instagram',chat_id:null,intent:'car_rent',source_text:'Pattaya 10–12 November',created_at:'2026-10-01T00:00:00Z'};
  const car = {id:'car-1',title:'Fiesta calendar-test',city:'Паттайя',status:'available',
    daily_price:300,weekly_price:null,monthly_price:null,currency:'THB',ownership_type:'pcs_owned',customer_visible:true};
  const sent = [];
  const queued = [];
  let operationalChecks = 0;
  const sb = {
    from(table) {
      const q = {
        newer:false, select(){return this;}, update(){return this;}, insert(){return this;},
        eq(){return this;}, is(){return this;}, not(){return this;}, in(){return this;}, lte(){return this;},
        gte(){return this;}, order(){return this;}, limit(){return this;},
        gt(){this.newer=true;return this;},
        result() {
          const data = table==='pcs_customer_followups' ? followup
            : table==='pcs_ai_generations' ? (this.newer ? null : generation)
            : table==='pcs_contacts' ? {id:'client-1',city:'Паттайя',language:'ru'}
            : table==='pcs_catalog_items' ? [car]
            : table==='pcs_reservations' ? [] : table==='pcs_messages' ? {channel:'instagram'} : null;
          return {data,error:null};
        },
        async maybeSingle(){return this.result();},
        then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);},
      };
      return q;
    },
    async rpc(name,input){
      if(name==='pcs_instagram_followup_enqueue'){queued.push(input);return {data:{queued:true,generation_id:followup.id},error:null};}
      return {data:name==='pcs_booking_quote'?{ok:true,manual_required:false,total_before_extras:1320,currency:'THB'}:false,error:null};
    },
  };
  const deps = {
    sb, carOffersReply, carOfferSnapshot, dateRange:()=>({start:'2026-11-10',end:'2026-11-12'}), lang:()=> 'ru',cityOf:()=> 'Паттайя',
    fx:async()=>null,tg:async(method,payload)=>{sent.push(payload);return {message_id:sent.length};},
    intro:()=> 'available', priceLine:realPriceLine,clean:x=>x,noConfirmed:()=> 'not_confirmed',
    cancel:async()=>({skip:'cancelled'}),cmap:{ru:'THB'},nonBlocking:new Set(['cancelled']),
    readOperationalAvailability:async()=>{operationalChecks++;return true;},operationalDb:async()=>({}),
  };
  const processOne = new Function(...Object.keys(deps),'return ('+handler+');')(...Object.values(deps));
  const result = await processOne(followup);
  assert.equal(sent.length,0,'Instagram recipients must never be addressed through Telegram');
  assert.equal(queued.length,1,'the follow-up must enter the existing durable Instagram outbox');
  assert.equal(queued[0].p_followup,followup.id);
  assert.match(queued[0].p_answer,/1[\\s\\u00a0\\u202f,]?320 THB/);
  assert.equal(queued[0].p_offer.options[0].total_before_extras,1320,'freeze the public quoted total');
  assert.equal(result.queued,true);
  assert.equal(result.sent,false,'queue acceptance is not delivery');
});
