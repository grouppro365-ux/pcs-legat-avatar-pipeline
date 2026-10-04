import {CrmError,contactId} from './crm-policy.mjs';
export const taskPriorities=['LOW','NORMAL','HIGH','URGENT'];
export function taskPatch(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['task_id','expected_version','title','comment','due_at','priority','assignee'].includes(k)))throw new CrmError('Некорректные поля задачи');
 contactId(b.task_id);
 if(typeof b.expected_version!=='string'||!/^\d{4}-\d{2}-\d{2} [\d:.]{8,15}$/.test(b.expected_version))throw new CrmError('Обновите задачу перед сохранением',409);
 const patch={};
 for(const [key,max] of [['title',300],['comment',4000],['assignee',200]])if(Object.hasOwn(b,key)){
  if(b[key]!==null&&(typeof b[key]!=='string'||b[key].length>max))throw new CrmError('Проверьте длину поля задачи');
  const value=b[key]?.trim()||null;if(key==='title'&&!value)throw new CrmError('Укажите название задачи');patch[key]=value;
 }
 if(Object.hasOwn(b,'priority')){if(!taskPriorities.includes(b.priority))throw new CrmError('Некорректный приоритет');patch.priority=b.priority}
 if(Object.hasOwn(b,'due_at')){const d=b.due_at;if(d!==null&&(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString()!==d))throw new CrmError('Некорректный срок задачи');patch.due_at=d}
 if(!Object.keys(patch).length)throw new CrmError('Нет изменений для сохранения');return patch;
}
export function taskUpdateQuery(cid,b,auditId){
 contactId(cid);const patch=taskPatch(b),fields=Object.keys(patch),set=fields.map(k=>`"${k}"=p."${k}"`).join(',');
 return{query:`with p as(select * from jsonb_populate_record(null::tasks,$1::jsonb)),changed as(update tasks t set ${set},updated_at=greatest(clock_timestamp(),t.updated_at+interval '1 microsecond') from p where t.id=$2 and t.contact_id=$3 and t.updated_at::text=$4 and t.completed_at is null returning t.*),audited as(insert into audit_logs(id,actor,action,entity_type,entity_id,payload) select $5,'pcs-manager-admin','task_updated','tasks',id,jsonb_build_object('contact_id',contact_id,'changed_fields',$6::jsonb) from changed returning id) select changed.*,changed.updated_at::text edit_version from changed where exists(select 1 from audited)`,params:[JSON.stringify(patch),b.task_id,cid,b.expected_version,auditId,JSON.stringify(fields)]};
}
export async function updateTask(sql,cid,b){const q=taskUpdateQuery(cid,b,crypto.randomUUID()),rows=await sql.query(q.query,q.params);if(!rows.length)throw new CrmError('Задача изменилась, завершена или недоступна. Откройте её заново; введённые данные сохранены в форме.',409);return{ok:true,task:rows[0]}}
export async function readTask(sql,cid,tid){contactId(cid);contactId(tid);const rows=await sql.query('select t.*,t.updated_at::text edit_version from tasks t where t.id=$1 and t.contact_id=$2 limit 1',[tid,cid]);if(!rows.length)throw new CrmError('Задача этого клиента не найдена',404);return{task:rows[0]}}
