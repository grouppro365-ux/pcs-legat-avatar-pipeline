import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

for(const scenario of ['global_off','settings_missing','settings_error','telegram_disabled','telegram_channel_disabled','reply_revoked','connection_missing','mid_delivery_off','unsupported_channel'])test(`follow-up delivery controls: ${scenario}`, async () => {
  const source = readFileSync(new URL('../pcs-customer-followup-v1/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function processOne(');
  const end = source.indexOf('\nDeno.serve(', start);
  assert.ok(start >= 0 && end > start, 'the deployed follow-up handler must be present');
  const handler = stripTypeScriptTypes(source.slice(start, end));
  const pricing = stripTypeScriptTypes(source.slice(source.indexOf('function fmt('), source.indexOf('function intro(')));
  const realPriceLine = new Function('zero', pricing+';return priceLine;')(new Set(['THB']));
  const followup = {id:'followup-1',generation_id:'generation-1',attempts:0,status:'pending'};
  const generation = {id:'generation-1',source_message_id:'source-1',contact_id:'client-1',
    business_connection_id:'telegram-test',chat_id:123,intent:'car_rent',source_text:'Pattaya 10–12 November',created_at:'2026-10-01T00:00:00Z'};
  const car = {id:'car-1',title:'Fiesta calendar-test',city:'Паттайя',status:'available',
    daily_price:300,weekly_price:null,monthly_price:null,currency:'THB',ownership_type:'pcs_owned',customer_visible:true};
  const sent = [];
  const updates = [];
  let operationalChecks = 0;
  const sb = {
    from(table) {
      const q = {
        newer:false, select(){return this;}, update(value){if(table==='pcs_customer_followups')updates.push(value);return this;}, insert(){return this;},
        eq(){return this;}, is(){return this;}, not(){return this;}, in(){return this;}, lte(){return this;},
        gte(){return this;}, order(){return this;}, limit(){return this;},
        gt(){this.newer=true;return this;},
        result() {
          const data = table==='pcs_settings' ? (scenario==='settings_missing'?null:{auto_send:scenario!=='global_off'&&(scenario!=='mid_delivery_off'||sent.length===0)})
            : table==='pcs_telegram_connections' ? (scenario==='connection_missing'?null:{enabled:scenario!=='telegram_disabled',can_reply:scenario!=='reply_revoked'})
            : table==='pcs_channel_connections' ? {enabled:scenario!=='telegram_channel_disabled',status:'active',public_config:{reply_mode:'auto'}}
            : table==='pcs_customer_followups' ? followup
            : table==='pcs_ai_generations' ? (this.newer ? null : generation)
            : table==='pcs_contacts' ? {id:'client-1',city:'Паттайя',language:'ru'}
            : table==='pcs_messages' ? {channel:scenario==='unsupported_channel'?'whatsapp':'telegram'}
            : table==='pcs_catalog_items' ? [car]
            : table==='pcs_reservations' ? [] : null;
          return {data,error:table==='pcs_settings'&&scenario==='settings_error'?{message:'lookup failed'}:null};
        },
        async maybeSingle(){return this.result();},
        then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);},
      };
      return q;
    },
    async rpc(name){return {data:name==='pcs_booking_quote'?{ok:true,manual_required:false,total_before_extras:1320,currency:'THB'}:false,error:null};},
  };
  const deps = {
    sb, dateRange:()=>({start:'2026-11-10',end:'2026-11-12'}), lang:()=> 'ru',cityOf:()=> 'Паттайя',
    fx:async()=>null,tg:async(method,payload)=>{sent.push(payload);return {message_id:sent.length};},
    intro:()=> 'available', priceLine:realPriceLine,clean:x=>x,noConfirmed:()=> 'not_confirmed',
    cancel:async()=>({skip:'cancelled'}),cmap:{ru:'THB'},nonBlocking:new Set(['cancelled']),
    readOperationalAvailability:async()=>{operationalChecks++;return true;},operationalDb:async()=>({}),
  };
  const processOne = new Function(...Object.keys(deps),'return ('+handler+');')(...Object.values(deps));
  const result = await processOne(followup);
  assert.equal(result.sent,false);
  assert.equal(sent.length,scenario==='mid_delivery_off'?1:0);
  const failure=updates.at(-1);
  assert.equal(failure.status,scenario==='mid_delivery_off'?'failed':'pending');
  assert.match(failure.last_error,/delivery_blocked:/);
  if(scenario==='mid_delivery_off')assert.deepEqual(failure.sent_message_ids,[1]);
  else assert.equal(failure.attempts,0,'paused work must not consume delivery attempts');
});
