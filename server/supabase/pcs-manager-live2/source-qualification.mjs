import {CrmError} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';
import {qualificationTypes,qualificationInput,qualificationAssessment} from './request-qualification.mjs';
const method='deterministic_exact_source_spans_v1';
const typeRules={car_rental:/(?:аренд[ауы]\s+(?:авто|автомобил[ьяяей]*|машин[уыа])|rent\s+(?:a\s+)?car|car\s+rental)/giu,property_rent:/(?:аренд[ауы]\s+(?:квартир[уыа]|жиль[яеё]|вилл[уыа])|rent\s+(?:an?\s+)?(?:apartment|condo|villa)|property\s+rental)/giu,property_buy:/(?:покупк[аиу]\s+(?:квартир[уыа]|недвижимости|вилл[уыа])|купить\s+(?:квартиру|виллу|недвижимость)|buy\s+(?:an?\s+)?(?:apartment|condo|villa|property))/giu,visa:/(?:нужна\s+виза|оформить\s+визу|visa\s+(?:application|service)|apply\s+for\s+(?:a\s+)?visa)/giu,transfer:/(?:нужен\s+трансфер|заказать\s+трансфер|airport\s+transfer|book\s+(?:a\s+)?transfer)/giu,service:/(?:тип\s+запроса\s*:\s*услуга|request\s+type\s*:\s*service)/giu};
const aliases={city:['город','city'],budget:['бюджет','budget'],requirements:['требования','requirements'],start_date:['начало аренды','дата заселения','start date','check-in'],end_date:['окончание аренды','дата выезда','end date','check-out'],vehicle_class:['класс автомобиля','vehicle class'],driver_age:['возраст водителя','driver age'],delivery:['место получения и возврата','delivery'],property_type:['тип жилья и число спален','тип объекта и число спален','property type'],guests:['число гостей','guests'],pets:['животные','pets'],purchase_goal:['цель покупки','purchase goal'],purchase_timing:['срок покупки','purchase timing'],ownership:['форма владения','ownership'],nationality:['гражданство заявителя','nationality'],current_status:['текущий визовый статус','current visa status'],current_location:['текущее местонахождение','current location'],target_visa:['нужная виза','target visa'],timeline:['желаемый срок оформления','timeline'],applicants:['количество заявителей','applicants'],pickup:['откуда забрать','pickup'],dropoff:['куда доставить','dropoff'],transfer_date:['дата поездки','transfer date'],transfer_time:['время подачи','transfer time'],passengers:['количество пассажиров','passengers'],luggage:['багаж','luggage'],child_seats:['детские кресла','child seats'],flight_number:['номер рейса','flight number'],service_need:['что нужно сделать','service need'],service_date:['когда нужен результат','service date'],participants:['для кого','participants']};
function span(source,start,end){return {start:[...source.slice(0,start)].length,end:[...source.slice(0,end)].length,quote:source.slice(start,end)};}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function extractSourceQualification(source){
 if(typeof source!=='string'||source.length>4000)throw new CrmError('Исходный запрос слишком длинный для автоматической квалификации',400);
 const found=Object.entries(typeRules).flatMap(([type,re])=>{re.lastIndex=0;const match=re.exec(source);return match?[{type,evidence:span(source,match.index,match.index+match[0].length)}]:[];});
 const type=found.length===1?found[0].type:null,answers={},evidence={type:type?found[0].evidence:null,answers:{}},conflicts=[];
 if(type){
  for(const key of Object.keys(qualificationTypes[type].fields)){
   const labels=new Set([qualificationTypes[type].fields[key].toLowerCase(),...(aliases[key]||[])]),matches=[];
   for(const match of source.matchAll(/(?:^|[\n;])\s*([^:\n;]{1,80})\s*:\s*([^\n;]+)/gu)){
    if(!labels.has(match[1].trim().toLowerCase()))continue;
    const value=match[2].trim();if(!value||value.length>1000)continue;
    const start=match.index+match[0].lastIndexOf(match[2])+match[2].indexOf(value);matches.push({value,evidence:span(source,start,start+value.length)});
   }
   if(new Set(matches.map(x=>x.value)).size>1){conflicts.push(key);continue;}
   if(matches.length){const chosen=matches[0];if(['start_date','end_date','transfer_date'].includes(key)&&!validDate(chosen.value)||key==='transfer_time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(chosen.value)){conflicts.push(key);continue;}answers[key]=chosen.value;evidence.answers[key]=chosen.evidence;}
  }
  if(answers.start_date&&answers.end_date&&answers.start_date>=answers.end_date){for(const key of ['start_date','end_date']){delete answers[key];delete evidence.answers[key];conflicts.push(key);}}
 }
 const assessment=type?qualificationAssessment(type,answers):{type:null,missing_questions:[],all_answers_recorded:false,verified_availability:false};
 return {type,answers,evidence,method,status:type?'EXTRACTED_UNVERIFIED':'NEEDS_TYPE',review_required:true,conflicts:[...new Set(conflicts)],...assessment,next_question:type?assessment.missing_questions[0]?.question||null:'Уточните услугу или направление запроса.'};
}
export const sourceQualificationQuery=`select id,client_visible_notes,qualification_data->'operator_qualification' operator_qualification,qualification_data->'source_qualification' source_qualification,md5(coalesce(client_visible_notes,'')) source_hash,md5(to_jsonb(a)::text) edit_version,selected_partner_offer_id,operational_status from applications a where id=$1::uuid`;
export async function qualifyApplicationFromSource(biz,id,authUser=null,requestId=crypto.randomUUID()){
 if(!uuid(id)||!uuid(requestId)||authUser!==null&&!uuid(authUser))throw new CrmError('Некорректная заявка или сотрудник',400);
 const app=(await biz.query(sourceQualificationQuery,[id]))[0];if(!app)throw new CrmError('Заявка не найдена',404);
 if(app.operator_qualification||app.selected_partner_offer_id||!['NEW','TRIAGE','NEEDS_CLIENT_INFO','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION'].includes(app.operational_status))return {ok:true,status:'OPERATOR_OR_FIXED_QUALIFICATION',updated:false};
 if(app.source_qualification?.method===method&&app.source_qualification.source_hash===app.source_hash)return {ok:true,status:'ALREADY_EXTRACTED',updated:false};
 if(typeof app.client_visible_notes!=='string'||!app.client_visible_notes.trim()||app.client_visible_notes.length>4000)return {ok:true,status:'SOURCE_UNAVAILABLE',updated:false};
 const extracted=extractSourceQualification(app.client_visible_notes);
 if(extracted.type)qualificationInput({id,request_id:requestId,expected_version:app.edit_version,type:extracted.type,answers:extracted.answers,source_note:'Exact recorded request spans; automatic extraction requires review'});
 try{
  const result=(await biz.query('select pcs.save_source_qualification($1::uuid,$2,$3::uuid,$4,$5::jsonb,$6::jsonb,$7,$8::uuid) result',[id,app.edit_version,requestId,extracted.type,JSON.stringify(extracted.answers),JSON.stringify(extracted.evidence),app.source_hash,authUser]))[0]?.result;
  if(result?.application_id!==id||!/^[a-f0-9]{32}$/.test(result.edit_version||''))throw new CrmError('Не получено подтверждение автоматической квалификации',502);
  return {ok:true,status:extracted.status,updated:true,result,assessment:{...qualificationAssessment(extracted.type,extracted.answers),next_question:extracted.next_question},review_required:true};
 }catch(e){if(/source_qualification_(changed|locked|retry_changed)/.test(e.message))throw new CrmError('Заявка изменилась. Автоматические ответы не сохранены.',409);if(/source_qualification_forbidden/.test(e.message))throw new CrmError('Недостаточно прав для квалификации',403);throw e;}
}
export async function qualifyRuntimeIntakeResult(biz,result,authUser=null){
 if(result?.ok!==true||!uuid(result.application?.id))return result;
 try{return {...result,source_qualification:await qualifyApplicationFromSource(biz,result.application.id,authUser)};}
 catch{return {...result,source_qualification:{ok:false,status:'EXTRACTION_UNAVAILABLE',updated:false,review_required:true}};}
}
