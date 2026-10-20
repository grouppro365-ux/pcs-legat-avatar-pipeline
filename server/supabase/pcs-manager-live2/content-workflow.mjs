import {verifyContentPublication} from './content-publication-verify.mjs';
import {CrmError} from './crm-policy.mjs';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const platforms=['telegram','instagram','facebook','youtube','tiktok','website'];
const languages=['ru','en','th','pl','es','zh','ja','ko','ar','fr','de','kk'];
export function contentInput(action,b){
 if(!b||typeof b!=='object'||Array.isArray(b))throw new CrmError('Проверьте данные материала');
 const fields={brand:['request_id','id','expected_version','name','guidelines'],create:['request_id','brand_id','platform','language','title','body','source_facts','source_url'],revise:['request_id','id','expected_version','platform','language','title','body','source_facts','source_url'],submit:['request_id','id','expected_version'],approve:['request_id','id','expected_version','revision','facts_checked','review_note'],schedule:['request_id','id','expected_version','scheduled_at'],'verify-publication':['request_id','id','expected_version'],'report-publication':['request_id','id','expected_version','publication_url','publication_note'],generate:['brand_id','platform','language','title','source_facts','source_url']};
 if(!fields[action]||Object.keys(b).some(k=>!fields[action].includes(k)))throw new CrmError('Неизвестное действие или поле');
 if(action!=='generate'&&!uuid.test(b.request_id))throw new CrmError('Обновите форму действия');
 for(const key of ['id','brand_id'])if(b[key]!=null&&!uuid.test(b[key]))throw new CrmError('Проверьте номер материала или бренда');
 if(!['brand','create','generate'].includes(action)&&!uuid.test(b.id))throw new CrmError('Не выбран материал');
 if((!['brand','create','generate'].includes(action)||action==='brand'&&b.id)&&(!Number.isSafeInteger(b.expected_version)||b.expected_version<1))throw new CrmError('Обновите материал перед сохранением',409);
 const limits={name:160,guidelines:12000,title:200,body:12000,source_facts:16000,source_url:2048,review_note:4000,publication_url:2048,publication_note:4000};
 for(const [k,max]of Object.entries(limits))if(b[k]!=null&&(typeof b[k]!=='string'||b[k].length>max))throw new CrmError('Проверьте длину поля '+k);
 if(['create','revise','generate'].includes(action)&&(!platforms.includes(b.platform)||!languages.includes(b.language)||!b.title?.trim()||!b.source_facts?.trim()||!/^https:\/\/\S+$/.test(b.source_url||'')||(action!=='generate'&&!b.body?.trim())||action!=='revise'&&!uuid.test(b.brand_id)))throw new CrmError('Заполните площадку, язык, текст и проверяемые факты с HTTPS-ссылкой');
 if(action==='approve'&&(b.facts_checked!==true||!Number.isSafeInteger(b.revision)||b.revision<1))throw new CrmError('Подтвердите проверку фактов этой редакции');
 if(action==='schedule'&&(typeof b.scheduled_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(b.scheduled_at)||!Number.isFinite(Date.parse(b.scheduled_at))))throw new CrmError('Укажите время публикации');
 return b;
}
export async function readContentWorkflow(biz,input={}){
 if(input.id&&!uuid.test(input.id))throw new CrmError('Неверный номер материала');
 const page=Number(input.page??0);if(!Number.isSafeInteger(page)||page<0||page>1000)throw new CrmError('Неверная страница');
 const [brands,posts]=await Promise.all([
 biz.query('select id,name,guidelines,version,updated_at from pcs.content_brands order by name,id limit 101',[]),
 biz.query(`select p.*,b.name brand_name,b.version current_brand_version,to_jsonb(r) revision from pcs.content_posts p join pcs.content_brands b on b.id=p.brand_id join lateral (select * from pcs.content_revisions where post_id=p.id order by revision desc limit 1) r on true where ($1::uuid is null or p.id=$1::uuid) order by p.updated_at desc,p.id limit 51 offset $2`,[input.id||null,input.id?0:page*50])]);
 const history=input.id?await biz.query('select revision,title,platform,language,body,source_facts,source_url,brand_version,qa,created_at,created_by from pcs.content_revisions where post_id=$1::uuid order by revision desc limit 21 offset $2',[input.id,page*20]):[];
 return {ok:true,brands:brands.slice(0,100),brands_truncated:brands.length>100,posts:posts.slice(0,50),has_more:posts.length>50,page,history:history.slice(0,20),history_has_more:history.length>20,platforms,languages};
}
export async function actContentWorkflow(biz,action,b,actor,permissions,generate){
 b=contentInput(action,b);
 const required=['approve','schedule','report-publication','verify-publication'].includes(action)?'content.approve':'content.edit';
 if(!Array.isArray(permissions)||!permissions.some(x=>x==='*'||x===required))throw new CrmError('Недостаточно прав для работы с контентом',403);
 if(action==='generate'){
  if(!generate)throw new CrmError('Генерация текста пока не подключена. Можно сохранить материал вручную.',503);
  const rows=await biz.query('select id,name,guidelines,version from pcs.content_brands where id=$1::uuid',[b.brand_id]);if(!rows.length)throw new CrmError('Бренд не найден',404);
  // Only the latest revision of each post in this exact editorial scope is context.
  // The extra row detects truncation; excerpts bound provider cost and data exposure.
  const recent=await biz.query(`select p.id,p.status,p.updated_at,r.title,left(r.body,1200) body_excerpt,r.revision from pcs.content_posts p join lateral (select revision,title,body,platform,language from pcs.content_revisions where post_id=p.id order by revision desc limit 1) r on true where p.brand_id=$1::uuid and r.platform=$2 and r.language=$3 order by p.updated_at desc,p.id limit 21`,[b.brand_id,b.platform,b.language]);
  const memory={scope:'brand_platform_language',limit:20,truncated:recent.length>20,items:recent.slice(0,20)};
  const body=await generate({...b,brand:rows[0],editorial_history:memory});if(typeof body!=='string'||!body.trim()||body.length>12000)throw new CrmError('Не удалось получить пригодный черновик',502);
  return {ok:true,body:body.trim(),status:'UNSAVED_DRAFT',requires_fact_check:true,editorial_history:{count:memory.items.length,limit:memory.limit,truncated:memory.truncated,scope:memory.scope},semantic_duplicate_check:'NOT_PERFORMED'};
 }
 try{if(action==='verify-publication')return await verifyContentPublication(biz,b,actor,permissions);const rows=await biz.query('select pcs.content_action($1,$2::jsonb,$3,$4::jsonb) result',[action,JSON.stringify(b),String(actor),JSON.stringify(permissions)]);return rows[0].result;}
 catch(e){const m=String(e.message||'');if(e.code==='42501'||/content_(forbidden|actor_invalid)/.test(m))throw new CrmError('Недостаточно прав для работы с контентом',403);if(/version_conflict|request_conflict/.test(m))throw new CrmError('Материал изменён. Обновите карточку и повторите действие.',409);if(/content_/.test(m))throw new CrmError('Действие не выполнено: проверьте статус, факты, QA и редакцию бренда.',400);throw e;}
}
