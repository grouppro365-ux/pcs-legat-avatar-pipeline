export function confirmationRequest(body,now=Date.now()) {
 if(!body||body.confirmed!==true)throw Error('confirmation_required');
 if(!['signature','handover'].includes(body.kind))throw Error('invalid_confirmation_kind');
 const occurred=Date.parse(body.occurred_at);
 if(typeof body.occurred_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(body.occurred_at)||!Number.isFinite(occurred)||occurred>now||occurred<Date.UTC(2000,0,1)||new Date(occurred).toISOString().slice(0,10)!==body.occurred_at.slice(0,10))throw Error('invalid_confirmation_date');
 const operator=typeof body.operator_name==='string'?body.operator_name.trim():'';
 const note=typeof body.note==='string'?body.note.trim():'';
 if(operator.length<2||operator.length>120)throw Error('operator_name_required');
 if(note.length<5||note.length>1000)throw Error('confirmation_note_required');
 return {kind:body.kind,occurred_at:new Date(occurred).toISOString(),operator_name:operator,note,confirmed:true};
}
export function handoverInput(value) {
 const result={};
 for(const key of ['fuel_level','condition_note','equipment'])if(typeof value?.[key]==='string')result[key]=value[key].slice(0,2000);
 return result;
}
