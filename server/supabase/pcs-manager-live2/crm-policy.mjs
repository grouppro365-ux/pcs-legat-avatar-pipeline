export class CrmError extends Error {
  constructor(message,status=400){super(message);this.status=status}
}
export async function readCrmBody(req){
  const reader=req.body?.getReader();if(!reader)throw new CrmError('Пустой запрос');
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw new CrmError('Запрос слишком большой',413)}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength}
  let b;try{b=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new CrmError('Некорректный запрос')}
  if(!b||typeof b!=='object'||Array.isArray(b))throw new CrmError('Некорректный запрос');return b;
}
export const contactStatuses=['NEW','QUALIFYING','QUALIFIED','OFFER_SENT','WAITING_CLIENT','IN_PROGRESS','BOOKED','PAID','COMPLETED','LOST','SPAM'];
export const contactPriorities=['LOW','NORMAL','HOT','URGENT'];
export const textFields={name:200,phone:100,username:100,language:20,city:200,country:200,need:4000,budget:500,next_action:4000};
export function contactId(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new CrmError('Некорректный номер клиента');return id}
const plain=b=>b&&typeof b==='object'&&!Array.isArray(b);
export function contactPatch(b){
  if(!plain(b)||typeof b.expected_version!=='string'||!/^\d{4}-\d{2}-\d{2} [\d:.]{8,15}$/.test(b.expected_version))throw new CrmError('Обновите карточку перед сохранением',409);
  const allowed=[...Object.keys(textFields),'status','priority','next_action_at','expected_version'];
  if(Object.keys(b).some(k=>!allowed.includes(k)))throw new CrmError('Поле не поддерживается этой карточкой');
  const patch={};
  for(const [key,max] of Object.entries(textFields))if(Object.hasOwn(b,key)){
    if(b[key]!==null&&(typeof b[key]!=='string'||b[key].length>max))throw new CrmError('Проверьте длину и формат поля');
    patch[key]=b[key]===null?null:b[key].trim()||null;
  }
  for(const [key,values] of [['status',contactStatuses],['priority',contactPriorities]])if(Object.hasOwn(b,key)){
    if(!values.includes(b[key]))throw new CrmError('Недопустимый статус или приоритет');patch[key]=b[key];
  }
  if(Object.hasOwn(b,'next_action_at')){
    const v=b.next_action_at;
    if(v!==null&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v.replace(/Z$/,v.includes('.')?'Z':'.000Z')))throw new CrmError('Некорректная дата следующего шага');
    patch.next_action_at=v;
  }
  if(!Object.keys(patch).length)throw new CrmError('Нет изменений для сохранения');
  return patch;
}
export function contactUpdateQuery(id,b,auditId){
  contactId(id);const patch=contactPatch(b),fields=Object.keys(patch);
  // Identifiers come exclusively from the fixed allowlist above; values stay parameterized.
  const set=fields.map(k=>`"${k}"=p."${k}"`).join(',');
  return {query:`with p as (select * from jsonb_populate_record(null::contacts,$1::jsonb)), changed as (update contacts c set ${set},updated_at=clock_timestamp() from p where c.id=$2 and c.updated_at::text=$3 returning c.*), audited as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload) select $4,'pcs-manager-admin','contact_updated','contacts',id,jsonb_build_object('changed_fields',$5::jsonb) from changed returning id) select changed.*,changed.updated_at::text edit_version from changed where exists(select 1 from audited)`,params:[JSON.stringify(patch),id,b.expected_version,auditId,JSON.stringify(fields)]};
}
export async function saveContact(sql,id,b){
  const q=contactUpdateQuery(id,b,crypto.randomUUID()),rows=await sql.query(q.query,q.params);
  if(!rows.length)throw new CrmError('Карточка изменилась или удалена. Откройте её заново; введённые данные сохранены в форме.',409);
  return {ok:true,contact:rows[0]};
}
export function taskInput(b){
  if(!plain(b)||Object.keys(b).some(k=>!['title','comment','due_at','id'].includes(k)))throw new CrmError('Некорректная задача');
  contactId(b.id);
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>300)throw new CrmError('Укажите задачу до 300 символов');
  if(b.comment!=null&&(typeof b.comment!=='string'||b.comment.length>4000))throw new CrmError('Комментарий слишком длинный');
  if(b.due_at!=null&&(typeof b.due_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(b.due_at)||!Number.isFinite(Date.parse(b.due_at))||new Date(b.due_at).toISOString()!==b.due_at))throw new CrmError('Некорректный срок задачи');
  return {...b,title:b.title.trim(),comment:b.comment?.trim()||null,due_at:b.due_at||null};
}
export function taskCreateQuery(cid,b,auditId){
  contactId(cid);b=taskInput(b);
  return {query:`with created as (insert into tasks(id,contact_id,title,comment,due_at) select $1,id,$3,$4,$5::timestamp from contacts where id=$2 on conflict(id) do nothing returning *), audited as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload) select $6,'pcs-manager-admin','task_created','tasks',id,jsonb_build_object('contact_id',contact_id) from created returning id) select created.* from created where exists(select 1 from audited) union all select * from tasks where id=$1 and contact_id=$2 and title=$3 and comment is not distinct from $4 and due_at is not distinct from $5::timestamp`,params:[b.id,cid,b.title,b.comment,b.due_at,auditId]};
}
export async function createTask(sql,cid,b){
  const q=taskCreateQuery(cid,b,crypto.randomUUID()),rows=await sql.query(q.query,q.params);
  if(!rows.length)throw new CrmError('Клиент не найден или задача с этим номером уже изменена',409);
  return {ok:true,task:rows[0]};
}
export function taskCompleteQuery(cid,tid,auditId){
  contactId(cid);contactId(tid);
  return {query:`with changed as (update tasks set completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and contact_id=$2 and completed_at is null returning *), audited as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload) select $3,'pcs-manager-admin','task_completed','tasks',id,jsonb_build_object('contact_id',contact_id) from changed returning id) select changed.* from changed where exists(select 1 from audited) union all select * from tasks where id=$1 and contact_id=$2 and completed_at is not null`,params:[tid,cid,auditId]};
}
export async function completeTask(sql,cid,tid){
  const q=taskCompleteQuery(cid,tid,crypto.randomUUID()),rows=await sql.query(q.query,q.params);
  if(!rows.length)throw new CrmError('Задача этого клиента не найдена',404);
  return {ok:true,task:rows[0]};
}
