import {CrmError} from './crm-policy.mjs';
export const searchQueries={
 contacts:`select id,name title,phone,username,city,need summary from contacts where strpos(lower(concat_ws(' ',name,phone,username,city,need)),lower($1))>0 order by updated_at desc,id limit 21 offset $2`,
 catalog:`select id,public_id,title,city,entity_type,availability_status from catalog_items where strpos(lower(concat_ws(' ',public_id,title,city,entity_type)),lower($1))>0 order by updated_at desc,id limit 21 offset $2`,
 applications:`select id,public_id,client_name title,client_contact,city,category,operational_status from applications where strpos(lower(concat_ws(' ',public_id,client_name,client_contact,city,category)),lower($1))>0 order by updated_at desc,id limit 21 offset $2`,
 partners:`select id,public_name title,legal_name,status from partners where strpos(lower(concat_ws(' ',public_name,legal_name)),lower($1))>0 order by updated_at desc,id limit 21 offset $2`,
 messages:`select m.id,cv.contact_id,c.name title,left(m.text,200) summary,m.direction,m.created_at from messages m join conversations cv on cv.id=m.conversation_id join contacts c on c.id=cv.contact_id where strpos(lower(coalesce(m.text,'')),lower($1))>0 order by m.created_at desc,m.id desc limit 21 offset $2`
};
export async function globalSearch(op,biz,q,scope='all',rawPage='0'){
 q=String(q||'').trim();if(q.length<2||q.length>120||!['all',...Object.keys(searchQueries)].includes(scope)||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Введите от 2 до 120 символов и корректный фильтр',400);
 const page=Number(rawPage),scopes=scope==='all'?Object.keys(searchQueries):[scope];
 const results=await Promise.allSettled(scopes.map(s=>(s==='contacts'||s==='messages'?op:biz).query(searchQueries[s],[q,page*20])));
 return{q,scope,page,limit:20,groups:scopes.map((s,i)=>results[i].status==='fulfilled'?{scope:s,rows:results[i].value.slice(0,20),truncated:results[i].value.length>20}:{scope:s,rows:[],truncated:false,error:'Источник временно недоступен. Повторите поиск.'})};
}
