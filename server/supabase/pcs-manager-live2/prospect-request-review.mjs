import {CrmError} from './crm-policy.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function prospectRejectQuery(b){return reviewQuery(b,false)}
export function prospectRestoreQuery(b){return reviewQuery(b,true)}
function reviewQuery(b,restore){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','request_id','expected_version','reason'].includes(k))||!uuid(b.id)||!uuid(b.request_id)||typeof b.expected_version!=='string'||b.expected_version.length>100||!Number.isFinite(Date.parse(b.expected_version))||typeof b.reason!=='string'||b.reason.trim().length<5||b.reason.length>600)throw new CrmError('Укажите причину и обновите найденный запрос',400);
 const input={id:b.id.toLowerCase(),expected_version:b.expected_version,reason:b.reason.trim(),...(restore?{action:'restore'}:{})};
 return {input,params:[input.id,input.expected_version,input.reason,b.request_id.toLowerCase(),JSON.stringify(input)],query:`with candidate as materialized (
 select id,decision,direction,reason from pcs_prospect_requests where id=$1 and updated_at::text=$2 and ${restore?"decision='rejected'":"decision in ('qualified','review')"} for update
 ),saved as (
 update pcs_prospect_requests r set decision='${restore?'review':'rejected'}',direction=null,reason=$3,outreach_status='${restore?'blocked_identity':'not_applicable'}',qualification_model='manual',qualification_version='${restore?'manual-restore-v1':'manual-reject-v1'}',updated_at=clock_timestamp()
 from candidate c where r.id=c.id returning r.id,r.decision,r.direction,r.reason,r.outreach_status,r.updated_at::text edit_version
 ),audited as (
 insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at)
 select $4,'admin','${restore?'prospect_request_restored':'prospect_request_rejected'}','prospect_request',s.id,jsonb_build_object('input',$5::jsonb,'before',to_jsonb(c),'receipt',to_jsonb(s)),now() from saved s join candidate c on c.id=s.id returning entity_id
 ) select s.* from saved s where exists(select 1 from audited a where a.entity_id=s.id)`};
}
async function replay(sql,b,input){
 const restore=input.action==='restore';
 const rows=await sql.query('select action,entity_id,payload from audit_logs where id=$1',[b.request_id.toLowerCase()]);if(!rows.length)return null;
 const x=rows[0],p=x.payload;if(x.action!==(restore?'prospect_request_restored':'prospect_request_rejected')||x.entity_id!==input.id||p?.input?.id!==input.id||p.input.expected_version!==input.expected_version||p.input.reason!==input.reason||p.input.action!==input.action||p.receipt?.id!==input.id||p.receipt.decision!==(restore?'review':'rejected'))throw new CrmError('Идентификатор решения уже использован для другого действия.',409);
 return {ok:true,request_id:b.request_id.toLowerCase(),request:p.receipt,replayed:true};
}
export async function rejectProspectRequest(sql,b){return saveReview(sql,b,prospectRejectQuery(b))}
export async function restoreProspectRequest(sql,b){return saveReview(sql,b,prospectRestoreQuery(b))}
async function saveReview(sql,b,q){const prior=await replay(sql,b,q.input);if(prior)return prior;const rows=await sql.query(q.query,q.params);if(!rows.length){const done=await replay(sql,b,q.input);if(done)return done;throw new CrmError('Запрос уже изменился. Причина остаётся в форме; обновите список перед повтором.',409);}return{ok:true,request_id:b.request_id.toLowerCase(),request:rows[0],replayed:false};}
