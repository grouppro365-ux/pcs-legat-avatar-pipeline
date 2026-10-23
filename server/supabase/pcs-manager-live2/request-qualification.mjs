import {CrmError} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';
const shared={city:'Город / район',budget:'Бюджет и валюта',requirements:'Требования клиента'};
export const qualificationTypes={
 car_rental:{title:'Аренда автомобиля',fields:{...shared,start_date:'Начало аренды',end_date:'Окончание аренды',vehicle_class:'Класс автомобиля',driver_age:'Возраст водителя',delivery:'Место получения и возврата'}},
 property_rent:{title:'Аренда недвижимости',fields:{...shared,start_date:'Дата заселения',end_date:'Дата выезда',property_type:'Тип жилья и число спален',guests:'Число гостей',pets:'Животные (нет / подробности)'}},
 property_buy:{title:'Покупка недвижимости',fields:{...shared,property_type:'Тип объекта и число спален',purchase_goal:'Цель покупки',purchase_timing:'Срок покупки',ownership:'Требования к форме владения'}},
 visa:{title:'Визы и документы',fields:{nationality:'Гражданство заявителя',current_status:'Текущий визовый статус и срок его действия',current_location:'Текущее местонахождение заявителя',target_visa:'Нужная виза / цель оформления',timeline:'Желаемый срок оформления',applicants:'Количество заявителей',requirements:'Дополнительные обстоятельства и вопросы'}},
 transfer:{title:'Трансфер',fields:{...shared,pickup:'Откуда забрать (адрес / аэропорт)',dropoff:'Куда доставить (адрес / аэропорт)',transfer_date:'Дата поездки в Таиланде',transfer_time:'Время подачи в Таиланде',passengers:'Количество пассажиров',luggage:'Количество и размер багажа',child_seats:'Детские кресла (нет / возраст детей)',flight_number:'Номер рейса (или не требуется)'}},
 service:{title:'Услуга / иной запрос',fields:{...shared,service_need:'Что нужно сделать',service_date:'Когда нужен результат',participants:'Для кого / количество участников'}}
};
export function qualificationAssessment(type,answers={}){
 const fields=Object.hasOwn(qualificationTypes,type)?qualificationTypes[type].fields:null;
 const missing=fields?Object.keys(fields).filter(k=>!String(answers?.[k]||'').trim()):[];
 return {type:fields?type:null,recorded:Boolean(fields),missing_questions:missing.map(key=>({key,question:fields[key]})),all_answers_recorded:Boolean(fields)&&missing.length===0,verified_availability:false};
}
export function qualificationInput(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','expected_version','request_id','type','answers','source_note'].includes(k))||!uuid(b.id)||!uuid(b.request_id)||!/^[a-f0-9]{32}$/.test(b.expected_version||'')||!Object.hasOwn(qualificationTypes,b.type)||!b.answers||Array.isArray(b.answers)||typeof b.answers!=='object'||typeof b.source_note!=='string'||b.source_note.trim().length<5||b.source_note.length>1000)throw new CrmError('Укажите тип запроса, источник ответов и обновите заявку',400);
 const fields=qualificationTypes[b.type].fields;
 if(Object.keys(b.answers).some(k=>!Object.hasOwn(fields,k)||typeof b.answers[k]!=='string'||b.answers[k].length>1000))throw new CrmError('Некорректные ответы квалификации',400);
 for(const k of ['start_date','end_date','transfer_date'])if(b.answers[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.answers[k])||!Number.isFinite(Date.parse(b.answers[k]))||new Date(b.answers[k]).toISOString().slice(0,10)!==b.answers[k]))throw new CrmError('Укажите корректные даты',400);
 if(b.answers.transfer_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.answers.transfer_time))throw new CrmError('Укажите время подачи в формате ЧЧ:ММ',400);
 if(b.answers.start_date&&b.answers.end_date&&b.answers.start_date>=b.answers.end_date)throw new CrmError('Дата окончания должна быть позже начала',400);
 return {...b,source_note:b.source_note.trim(),answers:Object.fromEntries(Object.entries(b.answers).map(([k,v])=>[k,v.trim()]))};
}
export async function readQualification(biz,id){
 if(!uuid(id))throw new CrmError('Некорректная заявка',400);
 const a=(await biz.query(`select id,public_id,city,client_visible_notes,operational_status,selected_partner_offer_id,qualification_data->'operator_qualification' qualification,qualification_data->'source_qualification' source_qualification,md5(coalesce(client_visible_notes,'')) source_hash,md5(to_jsonb(a)::text) edit_version from applications a where id=$1::uuid`,[id]))[0];
 if(!a)throw new CrmError('Заявка не найдена',404);
 const editable=!a.selected_partner_offer_id&&['NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION'].includes(a.operational_status);
 const saved=a.qualification,automatic=a.source_qualification;
 const sourceCurrent=automatic?.method==='deterministic_exact_source_spans_v1'&&automatic.source_hash===a.source_hash;
 return {application:a,types:qualificationTypes,editable,assessment:qualificationAssessment(saved?.type,saved?.answers),automatic:automatic?{...automatic,status:sourceCurrent?(automatic.type?'EXTRACTED_UNVERIFIED':'NEEDS_TYPE'):'STALE',review_required:true,...(sourceCurrent?{assessment:qualificationAssessment(automatic.type,automatic.answers)}:{})}:null};
}
export async function saveQualification(biz,input,authUser=null){
 const b=qualificationInput(input);if(authUser!==null&&!uuid(authUser))throw new CrmError('Недействительный сотрудник',403);
 try{const result=(await biz.query('select pcs.save_request_qualification($1::uuid,$2::text,$3::uuid,$4::text,$5::jsonb,$6::text,$7::uuid) result',[b.id,b.expected_version,b.request_id,b.type,JSON.stringify(b.answers),b.source_note,authUser]))[0]?.result;if(result?.application_id!==b.id||!/^[a-f0-9]{32}$/.test(result.edit_version||''))throw new CrmError('Не получено подтверждение сохранения. Повторите сохранение без изменения ответов.',502);return {ok:true,result};}
 catch(e){if(/qualification_forbidden/.test(e.message))throw new CrmError('Нет права квалификации заявок',403);if(/qualification_(changed|locked|retry_changed)/.test(e.message))throw new CrmError('Заявка изменилась или условия уже зафиксированы. Обновите карточку.',409);if(/qualification_invalid/.test(e.message))throw new CrmError('Проверьте ответы квалификации',400);throw e;}
}
