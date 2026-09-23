import {sb,tg,send,sec,RUNTIME} from './common.ts';
import {bookingConfirmationText} from './booking-confirmation.mjs';

async function notifyConfirmedCustomer(requestId:string,publicId:string){
  const {data:request,error}=await sb.from('pcs_booking_requests').select('id,status,contact_id,start_date,end_date,rental_total,booking_deposit_amount,currency,pcs_catalog_items(title),pcs_contacts(telegram_chat_id,business_connection_id,detected_language,language)').eq('id',requestId).single();
  if(error)throw error;
  if(request.status!=='booked')throw Error('booking_confirmation_requires_confirmed_status');
  const {data:claim,error:claimError}=await sb.rpc('pcs_claim_booking_confirmation',{p_request_id:requestId});
  if(claimError)throw claimError;
  if(!claim?.claimed)return claim?.reason==='already_sent'?'уже отправлено':'отправка уже выполняется';
  const claimId=claim.claim_id;
  try{
    const {data:prior,error:priorError}=await sb.from('pcs_messages').select('telegram_message_id').contains('raw',{source:'booking_confirmation',booking_request_id:requestId}).limit(1).maybeSingle();
    if(priorError)throw priorError;
    if(prior?.telegram_message_id){
      const {data:completed,error:finishError}=await sb.rpc('pcs_finish_booking_confirmation',{p_request_id:requestId,p_claim_id:claimId,p_message_id:prior.telegram_message_id,p_error:null});
      if(finishError||!completed)throw finishError||Error('booking_confirmation_finish_failed');
      return 'уже отправлено';
    }
    const contact=request.pcs_contacts as any;
    if(!contact?.telegram_chat_id||!contact?.business_connection_id)throw Error('booking_customer_telegram_address_missing');
    const language=String(contact.detected_language||contact.language||'ru').slice(0,2);
    const title=String((request.pcs_catalog_items as any)?.title||'автомобиль');
    const text=bookingConfirmationText(request,title,publicId,language);
    const sent=await tg('sendMessage',{business_connection_id:contact.business_connection_id,chat_id:String(contact.telegram_chat_id),text});
    const {error:messageError}=await sb.from('pcs_messages').insert({telegram_message_id:sent.message_id,business_connection_id:contact.business_connection_id,contact_id:request.contact_id,chat_id:contact.telegram_chat_id,direction:'out',text,status:'sent',raw:{...sent,source:'booking_confirmation',booking_request_id:requestId}});
    if(messageError)throw messageError;
    const {data:completed,error:finishError}=await sb.rpc('pcs_finish_booking_confirmation',{p_request_id:requestId,p_claim_id:claimId,p_message_id:sent.message_id,p_error:null});
    if(finishError||!completed)throw finishError||Error('booking_confirmation_finish_failed');
    return 'отправлено';
  }catch(e){
    await sb.rpc('pcs_finish_booking_confirmation',{p_request_id:requestId,p_claim_id:claimId,p_message_id:null,p_error:e instanceof Error?e.message:String(e)});
    throw e;
  }
}

async function finalizeIfReady(requestId:string,adminChat:any){
  const {data:request,error}=await sb.from('pcs_booking_requests').select('id,status,reservation_id').eq('id',requestId).maybeSingle();
  if(error)throw error;
  if(!request){await send(adminChat,'Заявка не найдена.');return}
  if(!['ready_for_booking','booked'].includes(request.status)){await send(adminChat,`Заявка пока не готова к брони: ${request.status}. Нужны проверенные документы и поступление предоплаты.`);return}
  const secret=await sec('internal_retry_secret');
  if(!secret)throw Error('internal_booking_secret_missing');
  const response=await fetch(RUNTIME+'/booking-finalize',{method:'POST',headers:{'content-type':'application/json','x-pcs-internal-secret':secret},body:JSON.stringify({request_id:requestId})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body?.ok){await send(adminChat,`Операционная бронь пока не создана: ${body?.error||response.status}. Проверьте доступность автомобиля; повторить можно командой /bfinalize ${requestId}.`);return}
  const result=body.result;
  if(result.status==='booked'){
    try{const notification=await notifyConfirmedCustomer(requestId,result.public_id||'');await send(adminChat,`Операционная бронь ${result.public_id||result.reservation_id} подтверждена. Уведомление клиенту: ${notification}.`)}
    catch(e){await send(adminChat,`Бронь подтверждена, но уведомление клиенту не доставлено: ${e instanceof Error?e.message:String(e)}. Повторите /bfinalize ${requestId}.`)}
    return;
  }
  await send(adminChat,`Операционная заявка ${result.public_id||result.reservation_id} создана, но её статус ${result.operational_status}. Клиенту не сообщать, что машина подтверждена, пока статус не станет CONFIRMED.`);
}

// Admin-only command, called after the gateway has checked pcs_admin_chats.
// A quote is saved before it is sent, so retries do not invent or change money.
export async function bookingAdminText(m:any){
  const text=String(m?.text||'').trim();
  if(text.startsWith('/bfinalize')){
    const id=text.match(/^\/bfinalize\s+([0-9a-f-]{36})$/i)?.[1];
    if(!id){await send(m.chat.id,'Формат: /bfinalize ID_ЗАЯВКИ');return true}
    await finalizeIfReady(id,m.chat.id);
    return true;
  }
  if(text.startsWith('/breceipt')){
    const match=text.match(/^\/breceipt\s+([0-9a-f-]{36})\s+(approved|rejected)$/i);
    if(!match){await send(m.chat.id,'Формат: /breceipt ID_ЗАЯВКИ approved|rejected. Сначала откройте /brequest ID и проверьте чек.');return true}
    const [,id,decision]=match;
    const {data:r,error}=await sb.from('pcs_booking_requests').select('id,status,payment_status,receipt_media_intake_id').eq('id',id).maybeSingle();
    if(error)throw error;
    if(!r||r.status!=='collecting'||r.payment_status!=='receipt_pending'||!r.receipt_media_intake_id){await send(m.chat.id,'Нет чека, ожидающего проверки по этой заявке.');return true}
    const {data:receipt,error:receiptError}=await sb.from('pcs_media_intake').select('id,classification,review_status,extracted').eq('id',r.receipt_media_intake_id).maybeSingle();
    if(receiptError)throw receiptError;
    if(!receipt||receipt.classification!=='receipt'||receipt.review_status!=='needs_review'||receipt.extracted?.booking_request_id!==id){await send(m.chat.id,'Чек не совпадает с заявкой или уже проверен.');return true}
    const {data:updated,error:updateError}=await sb.from('pcs_media_intake').update({review_status:decision,updated_at:new Date().toISOString()}).eq('id',receipt.id).eq('review_status','needs_review').select('id').maybeSingle();
    if(updateError)throw updateError;
    if(!updated){await send(m.chat.id,'Чек уже изменился. Откройте заявку заново.');return true}
    if(decision==='rejected'){
      const {error:resetError}=await sb.from('pcs_booking_requests').update({payment_status:'requested',updated_at:new Date().toISOString()}).eq('id',id).eq('receipt_media_intake_id',receipt.id).eq('payment_status','receipt_pending');
      if(resetError)throw resetError;
    }
    await sb.from('pcs_audit_logs').insert({actor:`telegram:${m.from?.id??m.chat.id}`,action:'booking_receipt_review',entity_type:'pcs_booking_requests',entity_id:id,payload:{decision,media_intake_id:receipt.id}});
    await send(m.chat.id,decision==='approved'?'Чек просмотрен. Это НЕ подтверждение поступления денег. Сверьте банк и затем отправьте /bpaid ID НОМЕР_ТРАНЗАКЦИИ.':'Чек отклонён. Ожидаем новый чек от клиента.');
    return true;
  }
  if(text.startsWith('/bpaid')){
    const match=text.match(/^\/bpaid\s+([0-9a-f-]{36})\s+([^\s]{6,120})$/i);
    if(!match){await send(m.chat.id,'Формат: /bpaid ID_ЗАЯВКИ НОМЕР_ТРАНЗАКЦИИ. Команда означает, что вы лично сверили поступление с банковской выпиской PCS; один чек без выписки недостаточен.');return true}
    const {data,error}=await sb.rpc('pcs_confirm_booking_deposit',{p_request_id:match[1],p_bank_reference:match[2],p_actor:`telegram:${m.from?.id??m.chat.id}`});
    if(error){await send(m.chat.id,'Не удалось подтвердить поступление: '+error.message);return true}
    await send(m.chat.id,`Поступление записано в финансах. Заявка: ${data.status}. Это ещё не созданная бронь; доступность автомобиля нужно перепроверить.`);
    if(data.status==='ready_for_booking')await finalizeIfReady(match[1],m.chat.id);
    return true;
  }
  if(text.startsWith('/brequest')){
    const id=text.match(/^\/brequest\s+([0-9a-f-]{36})$/i)?.[1];
    if(!id){await send(m.chat.id,'Формат: /brequest ID_ЗАЯВКИ');return true}
    const {data:r,error}=await sb.from('pcs_booking_requests').select('id,status,rental_total,currency,booking_deposit_amount,passport_status,international_permit_status,payment_status,passport_media_intake_id,permit_media_intake_id,receipt_media_intake_id').eq('id',id).maybeSingle();
    if(error)throw error;
    if(!r){await send(m.chat.id,'Заявка не найдена.');return true}
    const lines=[`Заявка ${r.id}`,`Статус: ${r.status}`,`Аренда: ${r.rental_total} ${r.currency}`,`Предоплата: ${r.booking_deposit_amount??'не назначена'} ${r.currency}`,`Паспорт: ${r.passport_status}`,`МВУ: ${r.international_permit_status}`,`Оплата: ${r.payment_status}`];
    for(const [label,intakeId] of [['Паспорт',r.passport_media_intake_id],['МВУ',r.permit_media_intake_id],['Чек',r.receipt_media_intake_id]] as const){
      if(!intakeId)continue;
      const {data:record,error:recordError}=await sb.from('pcs_media_intake').select('review_status,extracted').eq('id',intakeId).maybeSingle();
      if(recordError)throw recordError;
      const path=record?.extracted?.storage_path;
      if(typeof path!=='string'||!path.startsWith(`booking-requests/${r.id}/`))continue;
      const {data:link,error:linkError}=await sb.storage.from('pcs-contracts').createSignedUrl(path,120);
      if(linkError)throw linkError;
      lines.push(`${label} (${record.review_status}; ссылка 2 минуты): ${link.signedUrl}`);
    }
    await send(m.chat.id,lines.join('\n'));
    return true;
  }
  if(text.startsWith('/bdoc')){
    const match=text.match(/^\/bdoc\s+([0-9a-f-]{36})\s+(passport|permit)\s+(approved|rejected)$/i);
    if(!match){await send(m.chat.id,'Формат: /bdoc ID_ЗАЯВКИ passport|permit approved|rejected. Сначала откройте /brequest ID и проверьте файл.');return true}
    const [,id,kind,decision]=match;
    const column=kind==='passport'?'passport_media_intake_id':'permit_media_intake_id';
    const statusColumn=kind==='passport'?'passport_status':'international_permit_status';
    const {data:r,error}=await sb.from('pcs_booking_requests').select(`id,status,${column},${statusColumn}`).eq('id',id).maybeSingle();
    if(error)throw error;
    if(!r||r.status!=='collecting'||!r[column]||r[statusColumn]!=='received'){await send(m.chat.id,'Нет ожидающего проверки документа для этой заявки.');return true}
    const {data:record,error:recordError}=await sb.from('pcs_media_intake').select('id,classification,review_status,extracted').eq('id',r[column]).maybeSingle();
    if(recordError)throw recordError;
    const expected=kind==='passport'?'passport':'international_permit';
    if(!record||record.classification!==expected||record.review_status!=='needs_review'||record.extracted?.booking_request_id!==id){await send(m.chat.id,'Документ не совпадает с заявкой или уже проверен.');return true}
    const {data:updated,error:updateError}=await sb.from('pcs_booking_requests').update({[statusColumn]:decision,updated_at:new Date().toISOString()}).eq('id',id).eq(column,record.id).eq(statusColumn,'received').select('id').maybeSingle();
    if(updateError)throw updateError;
    if(!updated){await send(m.chat.id,'Документ изменился во время проверки. Откройте заявку заново.');return true}
    const {error:reviewError}=await sb.from('pcs_media_intake').update({review_status:decision,updated_at:new Date().toISOString()}).eq('id',record.id).eq('review_status','needs_review');
    if(reviewError)throw reviewError;
    await sb.from('pcs_audit_logs').insert({actor:`telegram:${m.from?.id??m.chat.id}`,action:'booking_document_review',entity_type:'pcs_booking_requests',entity_id:id,payload:{kind,decision,media_intake_id:record.id}});
    await send(m.chat.id,`${kind==='passport'?'Паспорт':'МВУ'}: ${decision}. Это не подтверждает оплату и не создаёт бронь.`);
    if(decision==='approved'){
      const {data:ready,error:readyError}=await sb.from('pcs_booking_requests').update({status:'ready_for_booking',updated_at:new Date().toISOString()}).eq('id',id).eq('status','collecting').eq('payment_status','paid').eq('passport_status','approved').eq('international_permit_status','approved').select('id').maybeSingle();
      if(readyError)throw readyError;
      if(ready)await finalizeIfReady(id,m.chat.id);
    }
    return true;
  }
  if(!text.startsWith('/bdeposit'))return false;
  const match=text.match(/^\/bdeposit\s+([0-9a-f-]{36})\s+([0-9]+(?:[.,][0-9]{1,2})?)$/i);
  if(!match){await send(m.chat.id,'Формат: /bdeposit ID_ЗАЯВКИ СУММА. Например: /bdeposit 00000000-0000-0000-0000-000000000000 2000');return true}
  const amount=Number(match[2].replace(',','.'));
  const {data:request,error}=await sb.from('pcs_booking_requests').select('id,contact_id,catalog_item_id,status,rental_total,currency,booking_deposit_amount,payment_status,pcs_catalog_items(title),pcs_contacts(telegram_chat_id,business_connection_id,name)').eq('id',match[1]).maybeSingle();
  if(error)throw error;
  if(!request){await send(m.chat.id,'Заявка не найдена.');return true}
  if(request.status!=='collecting'){await send(m.chat.id,'Для этой заявки нельзя назначить предоплату: статус '+request.status);return true}
  if(request.currency!=='THB'||!Number.isFinite(amount)||amount<=0||amount>Number(request.rental_total)){await send(m.chat.id,'Укажите сумму в THB больше нуля и не выше стоимости аренды.');return true}
  if(request.payment_status==='requested'||request.payment_status==='receipt_pending'||request.payment_status==='paid'){
    await send(m.chat.id,'Предоплата по этой заявке уже запрошена или получена. Повторное сообщение клиенту не отправляю.');return true;
  }
  const {data:priorMessage,error:priorError}=await sb.from('pcs_messages').select('id').contains('raw',{source:'booking_deposit_request',booking_request_id:request.id}).limit(1).maybeSingle();
  if(priorError)throw priorError;
  if(priorMessage){
    await sb.from('pcs_booking_requests').update({payment_status:'requested',updated_at:new Date().toISOString()}).eq('id',request.id).eq('payment_status','not_requested');
    await send(m.chat.id,'Запрос предоплаты уже отправлен клиенту. Повторно не отправляю.');
    return true;
  }
  const {error:saveError}=await sb.from('pcs_booking_requests').update({booking_deposit_amount:amount,updated_at:new Date().toISOString()}).eq('id',request.id).eq('status','collecting');
  if(saveError)throw saveError;
  const {data:route,error:routeError}=await sb.from('pcs_payment_routes').select('recipient_name,contact,payment_details').eq('route_type','pcs_payment').eq('active',true).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(routeError)throw routeError;
  if(!route?.payment_details){await send(m.chat.id,'Сумма '+amount+' THB сохранена. Клиенту реквизиты не отправлены: активный платёжный маршрут PCS не настроен.');return true}
  const contact=request.pcs_contacts as any;
  if(!contact?.telegram_chat_id||!contact?.business_connection_id){await send(m.chat.id,'Сумма сохранена, но у заявки нет действующего Telegram Business-адреса клиента.');return true}
  const money=(v:number)=>new Intl.NumberFormat('ru-RU').format(v)+' бат';
  const name=String((request.pcs_catalog_items as any)?.title||'автомобиль').replace(/^LTC-\d+\s*·\s*/iu,'');
  const clientText=`Для оформления ${name} бронировочная предоплата по вашей заявке — ${money(amount)}. Это часть аренды ${money(Number(request.rental_total))}, не залог за сохранность авто.\n\nПодтверждённые реквизиты PCS:\n${[route.recipient_name,route.contact,route.payment_details].filter(Boolean).join('\n')}\n\nПосле оплаты пришлите чек сюда. Поступление проверим отдельно; пока бронь не подтверждена.`;
  const outgoing=await tg('sendMessage',{business_connection_id:contact.business_connection_id,chat_id:String(contact.telegram_chat_id),text:clientText});
  const {error:messageError}=await sb.from('pcs_messages').insert({telegram_message_id:outgoing.message_id,business_connection_id:contact.business_connection_id,contact_id:request.contact_id,chat_id:contact.telegram_chat_id,direction:'out',text:clientText,status:'sent',raw:{...outgoing,source:'booking_deposit_request',booking_request_id:request.id}});
  if(messageError)throw messageError;
  const {error:statusError}=await sb.from('pcs_booking_requests').update({payment_status:'requested',updated_at:new Date().toISOString()}).eq('id',request.id).eq('payment_status','not_requested');
  if(statusError)throw statusError;
  await send(m.chat.id,'Сумма '+money(amount)+' отправлена клиенту. Чек и фактическое поступление ещё нужно проверить.');
  return true;
}
