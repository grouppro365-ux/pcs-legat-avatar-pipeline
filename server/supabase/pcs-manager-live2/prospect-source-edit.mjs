import {CrmError} from './crm-policy.mjs';
export function prospectSourceEditQuery(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','expected_version','enabled','competitor','rules'].includes(k))||typeof b.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id)||typeof b.expected_version!=='string'||b.expected_version.length>100||!Number.isFinite(Date.parse(b.expected_version))||typeof b.enabled!=='boolean'||typeof b.competitor!=='boolean'||typeof b.rules!=='string'||b.rules.length>2000)throw new CrmError('Проверьте настройки источника и обновите его версию',400);
 return {query:`with candidate as materialized (
 select s.id,s.enabled,s.topic,s.rules from pcs_prospect_sources s where s.id=$1 and s.updated_at::text=$2 for update
 ),saved as (
 update pcs_prospect_sources s set enabled=$3,topic=case when $4 then 'competitor' when s.topic='competitor' then 'community' else s.topic end,rules=$5,
 lease_id=case when $3 then s.lease_id else null end,lease_until=case when $3 then s.lease_until else null end,updated_at=clock_timestamp()
 from candidate c where s.id=c.id returning s.id,s.username,s.enabled,s.topic,s.rules,s.updated_at::text edit_version
 ),audited as (
 insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at)
 select $6,'admin','prospect_source_updated','prospect_source',s.id,jsonb_build_object('before',jsonb_build_object('enabled',c.enabled,'topic',c.topic,'rules',c.rules),'after',jsonb_build_object('enabled',s.enabled,'topic',s.topic,'rules',s.rules)),now() from saved s join candidate c on c.id=s.id returning entity_id
 ) select s.* from saved s where exists(select 1 from audited a where a.entity_id=s.id)`,params:[b.id,b.expected_version,b.enabled,b.competitor,b.rules.trim()||null,crypto.randomUUID()]};
}
export async function updateProspectSource(sql,b){
 const q=prospectSourceEditQuery(b),rows=await sql.query(q.query,q.params);
 if(!rows.length)throw new CrmError('Источник уже изменился. Черновик остаётся в форме; обновите список перед повтором.',409);
 return {ok:true,source:rows[0]};
}
