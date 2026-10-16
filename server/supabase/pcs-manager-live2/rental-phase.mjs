import {CrmError,readCrmBody} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';

export async function advanceRentalPhase(req,biz,db,staff=null){
 if(req.method!=='POST')throw new CrmError('Метод не поддерживается',405);
 const b=await readCrmBody(req);
 if(!uuid(b.id)||Object.keys(b).some(k=>!['id','expected_status','status'].includes(k))||!((b.expected_status==='CONFIRMED'&&b.status==='SERVICE_IN_PROGRESS')||(b.expected_status==='SERVICE_IN_PROGRESS'&&b.status==='COMPLETED')))throw new CrmError('invalid_rental_transition',400);
 const app=(await biz.query('select id,item_id,category,client_name,client_contact,execution_issue_status,qualification_data,operational_status,updated_at::text edit_version from applications where id=$1::uuid',[b.id]))[0];
 if(!app||app.category!=='booking'||app.operational_status!==b.expected_status)throw new CrmError('rental_status_changed',409);
 // A raw authenticated status POST is insufficient: independently read the existing contract facts.
 const {data:reservation,error:re}=await db.from('pcs_reservations').select('id,source,catalog_item_id').eq('id',b.id).maybeSingle();
 if(re)throw new CrmError('rental_proof_unavailable',503);
 if(!reservation||reservation.source!=='neon_contract_projection'||reservation.catalog_item_id!==app.item_id)throw new CrmError('rental_contract_required',409);
 const {data:c,error:ce}=await db.from('pcs_contracts').select('id,status,version,missing_fields,rental_data,handover_data').eq('reservation_id',b.id).not('status','in','(superseded,cancelled)').order('version',{ascending:false}).limit(1).maybeSingle();
 if(ce)throw new CrmError('rental_proof_unavailable',503);
 const q=app.qualification_data||{};
 if(!c||!['ready_to_sign','signed'].includes(c.status)||!Array.isArray(c.missing_fields)||c.missing_fields.length||c.rental_data?.start_date!==q.start_date||c.rental_data?.end_date!==q.end_date)throw new CrmError('contract_not_current',409);
 const context=c.handover_data?.generation_context;
 if(!context||context.catalog_item_id!==app.item_id||String(context.client_name||'')!==String(app.client_name||'')||String(context.client_contact||'')!==String(app.client_contact||''))throw new CrmError('contract_not_current',409);
 if(b.status==='COMPLETED'&&!['NONE','RESOLVED'].includes(app.execution_issue_status))throw new CrmError('execution_issue_unresolved',409);
 const h=c.handover_data?.handover_confirmation,r=c.handover_data?.return_confirmation;
 const valid=f=>f?.method==='operator_attestation'&&typeof f.actor==='string'&&f.actor.startsWith('admin-session:')&&Number.isFinite(Date.parse(f.occurred_at))&&Date.parse(f.occurred_at)<=Date.now();
 if(!valid(h))throw new CrmError('handover_required',409);
 if(b.status==='COMPLETED'&&(!valid(r)||Date.parse(r.occurred_at)<Date.parse(h.occurred_at)))throw new CrmError('return_required',409);
 const changed=await biz.query(`with saved as (
 update applications set operational_status=$2,updated_at=clock_timestamp() where id=$1::uuid and category='booking' and operational_status=$3 and updated_at::text=$4 returning id
 ), audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select $5,'booking.rental_phase','applications',id::text,jsonb_build_object('previous_status',$3::text,'status',$2::text,'contract_id',$6::text,'auth_user_id',$7::text),'Server verified contract attestation','SUCCESS' from saved returning entity_id
 ) select id from saved where exists(select 1 from audited where entity_id=saved.id::text)`,[b.id,b.status,b.expected_status,app.edit_version,staff?'STAFF':'ADMIN',c.id,staff?.auth_user_id||null]);
 if(!changed.length)throw new CrmError('rental_status_changed',409);
 return {ok:true};
}
