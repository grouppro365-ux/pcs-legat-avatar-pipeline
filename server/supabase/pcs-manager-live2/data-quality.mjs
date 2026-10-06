import {CrmError} from './crm-policy.mjs';
export const qualityViews=['telegram','phone','overdue','missing_date'];
export function dataQualityQuery(view='telegram',rawPage='0'){
 if(!qualityViews.includes(view)||typeof rawPage!=='string'||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Некорректный фильтр качества CRM',400);
 const page=Number(rawPage),fields='id,name,username,phone,city,status::text,next_action,(next_action_at at time zone \'UTC\') next_action_at';
 let query;
 if(view==='telegram'||view==='phone'){
  const key=view==='telegram'?"case when telegram_user_id>0 then telegram_user_id::text end":"case when regexp_replace(btrim(phone),'[[:space:]().-]','','g') ~ '^\\+?[0-9]{7,15}$' then regexp_replace(btrim(phone),'[[:space:]().-]','','g') end";
  query=`with normalized as(select ${fields},${key} match_key from contacts),matches as(select *,count(*) over(partition by match_key)::int duplicate_count from normalized where match_key is not null) select * from matches where duplicate_count>1 order by duplicate_count desc,match_key,id limit 51 offset $1`;
 }else{
  const condition=view==='overdue'?"next_action_at<(now() at time zone 'UTC')":"nullif(btrim(next_action),'') is not null and next_action_at is null";
  query=`select ${fields} from contacts where status::text not in ('COMPLETED','LOST','SPAM') and ${condition} order by next_action_at nulls last,id limit 51 offset $1`;
 }
 return {view,page,query,params:[page*50]};
}
export async function readDataQuality(op,view,page){const q=dataQualityQuery(view,page),rows=await op.query(q.query,q.params);return {view:q.view,page:q.page,rows:rows.slice(0,50),truncated:rows.length>50};}
