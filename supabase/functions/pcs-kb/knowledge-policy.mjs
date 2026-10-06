export class KnowledgeError extends Error{constructor(message,status=400){super(message);this.status=status}}
export const knowledgeStatuses=['active','draft','outdated','disabled'];
export const knowledgeVisibility=['customer_safe','approval_only','internal_only'];
export function knowledgeInput(body,create=false){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new KnowledgeError('Некорректная запись');
 const limits={title:300,category:100,description:20000,city:200,currency:8,conditions:8000,restrictions:8000,source:2000,operator_comment:8000,answer_guidance:8000};
 const allowed=[...Object.keys(limits),'id','expected_revision','visibility','status','auto_answer_allowed','price','valid_until'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))throw new KnowledgeError('Поле записи не поддерживается');
 if(create&&!(typeof body.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)))throw new KnowledgeError('Некорректный номер новой записи');
 if(!create&&(!Number.isInteger(body.expected_revision)||body.expected_revision<1))throw new KnowledgeError('Откройте актуальную запись перед сохранением',409);
 const record={};for(const [k,max]of Object.entries(limits)){const v=body[k];if(v!=null&&(typeof v!=='string'||v.length>max))throw new KnowledgeError('Проверьте длину и формат полей');record[k]=typeof v==='string'?v.trim()||null:null;}
 if(!record.title||!record.category||!record.description)throw new KnowledgeError('Название, категория и информация обязательны');
 if(!knowledgeStatuses.includes(body.status)||!knowledgeVisibility.includes(body.visibility)||typeof body.auto_answer_allowed!=='boolean')throw new KnowledgeError('Проверьте статус и доступ записи');
 record.status=body.status;record.visibility=body.visibility;record.auto_answer_allowed=body.auto_answer_allowed;
 if(record.auto_answer_allowed&&(record.status!=='active'||record.visibility!=='customer_safe'))throw new KnowledgeError('Автоматический ответ допустим только для активной записи «Можно клиенту»');
 const price=body.price;if(price!=null&&(typeof price!=='string'||!/^\d{1,15}(?:\.\d{1,6})?$/.test(price)))throw new KnowledgeError('Цена: неотрицательное число, до 6 знаков после точки');record.price=price??null;
 if(record.price!==null&&(!record.currency||!/^[A-Z]{3}$/.test(record.currency)))throw new KnowledgeError('Укажите валюту цены тремя латинскими буквами');
 const date=body.valid_until;if(date!=null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date.replace(/Z$/,date.includes('.')?'Z':'.000Z')))throw new KnowledgeError('Некорректная дата срока действия');record.valid_until=date??null;
 if(record.auto_answer_allowed&&date&&Date.parse(date)<Date.now())throw new KnowledgeError('Срок действия истёк. Отключите автоматический ответ или обновите срок');
 return {id:create?body.id:null,expected_revision:create?null:body.expected_revision,record};
}
