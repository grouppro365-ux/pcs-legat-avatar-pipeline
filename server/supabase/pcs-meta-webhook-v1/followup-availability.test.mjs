import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

test('real follow-up handler excludes a car blocked by the operational calendar', async () => {
  const source = readFileSync(new URL('../pcs-customer-followup-v1/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function processOne(');
  const end = source.indexOf('\nDeno.serve(', start);
  assert.ok(start >= 0 && end > start, 'the deployed follow-up handler must be present');
  const handler = stripTypeScriptTypes(source.slice(start, end));
  const followup = {id:'followup-1',generation_id:'generation-1',attempts:0,status:'pending'};
  const generation = {id:'generation-1',source_message_id:'source-1',contact_id:'client-1',
    business_connection_id:'telegram-test',chat_id:123,intent:'car_rent',source_text:'Pattaya 10–12 November',created_at:'2026-10-01T00:00:00Z'};
  const car = {id:'car-1',title:'Fiesta calendar-test',city:'Паттайя',status:'available',
    daily_price:300,weekly_price:null,monthly_price:null,currency:'THB',ownership_type:'pcs_owned',customer_visible:true};
  const sent = [];
  let operationalChecks = 0;
  const sb = {
    from(table) {
      const q = {
        newer:false, select(){return this;}, update(){return this;}, insert(){return this;},
        eq(){return this;}, is(){return this;}, not(){return this;}, in(){return this;}, lte(){return this;},
        gte(){return this;}, order(){return this;}, limit(){return this;},
        gt(){this.newer=true;return this;},
        result() {
          const data = table==='pcs_settings' ? {auto_send:true}
            : table==='pcs_telegram_connections' ? {enabled:true,can_reply:true}
            : table==='pcs_channel_connections' ? {enabled:true,status:'active',public_config:{reply_mode:'auto'}}
            : table==='pcs_customer_followups' ? followup
            : table==='pcs_ai_generations' ? (this.newer ? null : generation)
            : table==='pcs_contacts' ? {id:'client-1',city:'Паттайя',language:'ru'}
            : table==='pcs_catalog_items' ? [car]
            : table==='pcs_reservations' ? [] : null;
          return {data,error:null};
        },
        async maybeSingle(){return this.result();},
        then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);},
      };
      return q;
    },
    async rpc(){return {data:false,error:null};},
  };
  const deps = {
    sb, dateRange:()=>({start:'2026-11-10',end:'2026-11-12'}), lang:()=> 'ru',cityOf:()=> 'Паттайя',
    fx:async()=>null,tg:async(method,payload)=>{sent.push(payload);return {message_id:sent.length};},
    intro:()=> 'available', priceLine:()=> '600 THB',clean:x=>x,noConfirmed:()=> 'not_confirmed',
    cancel:async()=>({skip:'cancelled'}),cmap:{ru:'THB'},nonBlocking:new Set(['cancelled']),
    readOperationalAvailability:async()=>{operationalChecks++;return false;},operationalDb:async()=>({}),
  };
  const processOne = new Function(...Object.keys(deps),'return ('+handler+');')(...Object.values(deps));
  const result = await processOne(followup);
  assert.equal(result.sent,true,result.error || 'the handler must complete without fixture errors');
  assert.equal(sent.some(p=>String(p.text||p.caption||'').includes(car.title)),false,
    'an empty Supabase calendar must not override the operational booking conflict');
  assert.equal(operationalChecks,1,'availability must consult the operational calendar');
});
