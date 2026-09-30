import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as journey from '../../supabase/functions/pcs-business-runtime-v8/vehicle-offer.mjs';
import './all.test.mjs';
import './followup.test.mjs';

test('explicit vehicle choice uses the delivered offer rather than mutable catalog prices',()=>{
  const offer={id:'offer-a',intent:'car_rent',start:'2026-11-10',end:'2026-11-12',created_at:'2026-09-30T16:00:00Z',items:[{id:'fiesta',title:'Fiesta',total:600,currency:'THB'},{id:'mg5',title:'MG5',total:1320,currency:'THB'}]};
  const result=journey.resolveVehicleChoice?.('2',offer,Date.parse('2026-09-30T17:00:00Z'))||null;
  assert.equal(result?.action,'select');
  assert.equal(result?.index,1);
  assert.equal(result?.item.total,1320);
  assert.equal(offer.selected_index,undefined);
});
test('booking confirmation requires a fresh valid offer and an explicit prior selection',()=>{
  const now=Date.parse('2026-09-30T17:00:00Z');
  const offer={id:'offer-a',intent:'car_rent',start:'2026-11-10',end:'2026-11-12',created_at:'2026-09-30T16:00:00Z',stage:'awaiting_confirmation',selected_index:0,items:[{id:'mg5',title:'MG5',total:1320,currency:'THB'}]};
  const resolve=(value,text='Хочу оформить')=>journey.resolveVehicleChoice(text,value,now);
  assert.equal(resolve(offer)?.action,'confirm');
  assert.equal(resolve({...offer,stage:undefined,selected_index:undefined})?.action,'choose_first');
  assert.equal(resolve({...offer,created_at:'2026-09-28T16:00:00Z'})?.action,'expired');
  assert.equal(resolve({...offer,created_at:'bad-date'})?.action,'expired');
  assert.equal(resolve({...offer,items:[{...offer.items[0],total:0}]})?.action,'invalid_quote');
  assert.equal(resolve({...offer,end:'2026-11-09'})?.action,'invalid_quote');
  assert.equal(resolve({...offer,selected_index:4})?.action,'invalid_choice');
  assert.equal(resolve(offer,'не бронируйте'),null);
});
test('choice then explicit confirmation creates a collecting request, never a confirmed reservation',async()=>{
  const now=Date.parse('2026-09-30T17:00:00Z');
  const offer={id:'offer-a',intent:'car_rent',start:'2026-11-10',end:'2026-11-12',created_at:'2026-09-30T16:00:00Z',items:[{id:'mg5',title:'MG5',total:1320,currency:'THB'}]};
  const rows=new Map();let available=true;
  const store={
    item:async()=>({id:'mg5',title:'MG5',status:'available',customer_visible:true,deleted_at:null,ownership_type:'pcs_owned',metadata:{security_deposit_thb:10000}}),
    available:async()=>available,
    request:async(input)=>{const key=input.offer_id;if(!rows.has(key))rows.set(key,{id:'request-a',status:'collecting',...input});return rows.get(key)}
  };
  const run=async(text,value)=>await journey.continueVehicleBooking?.({text,offer:value,contactId:'contact-a',store,now})||null;
  const selection=await run('1',offer);
  assert.equal(selection?.offer.stage,'awaiting_confirmation');
  assert.equal(rows.size,0);
  const confirmation=await run('Хочу оформить',selection.offer);
  assert.equal(confirmation?.request.status,'collecting');
  assert.equal(confirmation?.request.rental_total,1320);
  assert.match(confirmation?.answer,/паспорт.*международн/iu);
  assert.match(confirmation?.answer,/не забронирован/iu);
  const again=await run('Хочу оформить',confirmation.offer);
  assert.equal(again?.request.id,'request-a');
  assert.equal(rows.size,1);
  available=false;
  assert.equal((await run('1',offer))?.action,'unavailable');
  assert.equal(rows.size,1);
});
test('unpublished, foreign or partner inventory cannot create an owned-fleet booking request',async()=>{
  const now=Date.parse('2026-09-30T17:00:00Z');
  const offer={id:'offer-a',intent:'car_rent',start:'2026-11-10',end:'2026-11-12',created_at:'2026-09-30T16:00:00Z',stage:'awaiting_confirmation',selected_index:0,items:[{id:'mg5',title:'MG5',total:1320,currency:'THB'}]};
  const base={id:'mg5',title:'MG5',status:'available',customer_visible:true,deleted_at:null,ownership_type:'pcs_owned'};
  for(const [patch,expected] of [[{status:'under_review'},'unavailable'],[{deleted_at:'2026-09-30'},'unavailable'],[{customer_visible:false},'unavailable'],[{id:'other'},'unavailable'],[{ownership_type:'partner'},'partner_confirmation']]){
    let requests=0;
    const result=await journey.continueVehicleBooking({text:'Хочу оформить',offer,contactId:'contact-a',now,
      store:{item:async()=>({...base,...patch}),available:async()=>true,request:async()=>{requests++;return {id:'bad-request',status:'collecting'}}}});
    assert.equal(result.action,expected);
    assert.equal(requests,0);
  }
});
test('social choice loads only a delivered offer for the same contact and channel before creating a request',async()=>{
  const {readFileSync}=await import('node:fs');
  const vm=await import('node:vm');
  const source=readFileSync(new URL('../../server/supabase/pcs-meta-webhook-v1/index.ts',import.meta.url),'utf8');
  const definition=source.match(/async function structuredCarRentalSelection\([^]*?\n}\n/);
  const receipt={id:'generation-a',created_at:new Date().toISOString(),status:'sent',offer_snapshot:{version:1,intent:'car_rent',start_date:'2026-11-10',end_date:'2026-11-12',options:[{catalog_item_id:'mg5',title:'MG5',total_before_extras:1320,currency:'THB',security_deposit_thb:10000}]}};
  const requests=[];const filters=[];let visible=receipt;
  const item={id:'mg5',title:'MG5',status:'available',customer_visible:true,deleted_at:null,ownership_type:'pcs_owned',metadata:{security_deposit_thb:10000}};
  const sb={rpc:async()=>({data:false,error:null}),from(table){
    let values,conditions={};
    const q={select(){return q},eq(k,v){conditions[k]=v;filters.push([table,k,v]);return q},not(){return q},order(){return q},limit(){return q},insert(input){values=input;return q},
      async maybeSingle(){return {data:table==='pcs_ai_generations'?(visible?.status===conditions.status?visible:null):table==='pcs_catalog_items'?item:requests.find(x=>x.offer_id===conditions.offer_id)||null,error:null}},
      async single(){const r={id:'request-a',status:'collecting',...values};requests.push(r);return {data:r,error:null}}};
    return q;
  }};
  const context={sb,continueVehicleBooking:journey.continueVehicleBooking,operationalDb:async()=>null,readOperationalAvailability:async()=>true};
  if(definition)vm.runInNewContext(definition[0]+';handler=structuredCarRentalSelection;',context);
  const selection=await context.handler?.('contact-a','1','instagram')||null;
  assert.equal(selection?.model,'car-rental-choice-v1');
  assert.equal(selection?.offerSnapshot.stage,'awaiting_confirmation');
  assert.equal(requests.length,0);
  visible={...receipt,offer_snapshot:selection.offerSnapshot};
  const confirmation=await context.handler('contact-a','Хочу оформить','instagram');
  assert.equal(confirmation?.bookingRequestId,'request-a');
  assert.equal(requests[0].rental_total,1320);
  assert.equal((await context.handler('contact-a','Хочу оформить','instagram')).bookingRequestId,'request-a');
  assert.equal(requests.length,1);
  for(const key of ['contact_id','business_connection_id','status'])assert.ok(filters.some(x=>x[0]==='pcs_ai_generations'&&x[1]===key));
  visible={...receipt,status:'approval_required'};
  assert.equal(await context.handler('contact-a','1','instagram'),null);
});

