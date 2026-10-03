const text=value=>String(value??'').trim().toLowerCase();
const contact=value=>{const s=text(value);return /^\+?[\d\s()+-]+$/.test(s)?s.replace(/\D/g,''):s;};
const filled=value=>value!==null&&value!==undefined&&String(value).trim()!=='';

// Only carry editable document fields. Prices, signatures and evidence stay
// attached to their original version; booking data is always read afresh.
export function carryVersionFields(snapshot,previous,input={}) {
 if(!previous||['cancelled','superseded'].includes(previous.status))return snapshot;
 const current=snapshot.handover.generation_context;
 const old=previous.handover_data?.generation_context;
 const oldRenter=previous.renter_data||{};
 const priorContact=old?.client_contact||oldRenter.phone||oldRenter.line||oldRenter.telegram;
 const sameClient=filled(current.client_name)&&text(current.client_name)===text(old?.client_name||oldRenter.name)
  &&text(snapshot.renter.name)===text(current.client_name)&&text(oldRenter.name)===text(current.client_name)
  &&filled(current.client_contact)&&contact(current.client_contact)===contact(priorContact)
  &&(!old?.contact_id||old.contact_id===current.contact_id);
 const sameVehicle=old?.catalog_item_id
  ?old.catalog_item_id===current.catalog_item_id
  :filled(snapshot.vehicle.registration_no)&&text(snapshot.vehicle.registration_no)===text(previous.vehicle_data?.registration_no);
 const copy=(section,source,keys)=>{for(const key of keys){
  if(!Object.hasOwn(input?.[section]||{},key)&&!filled(snapshot[section][key])&&filled(source?.[key]))snapshot[section][key]=source[key];
 }};
 if(sameClient)copy('renter',oldRenter,['id_or_passport','nationality','license_no','phone','line','telegram','address']);
 if(sameVehicle)copy('vehicle',previous.vehicle_data,['model','registration_no','color','fuel_type']);
 if(sameClient&&sameVehicle){
  const rental=previous.rental_data||{};
  if(snapshot.rental.start_date===rental.start_date)copy('rental',rental,['start_time']);
  if(snapshot.rental.end_date===rental.end_date)copy('rental',rental,['end_time']);
  if(snapshot.rental.start_date===rental.start_date&&snapshot.rental.end_date===rental.end_date){
   copy('rental',rental,['remark']);
   copy('handover',previous.handover_data,['fuel_level','condition_note','equipment']);
  }
 }
 return snapshot;
}
