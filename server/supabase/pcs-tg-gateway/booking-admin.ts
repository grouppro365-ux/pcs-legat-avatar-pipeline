import {sb,tg,send} from './common.ts';

// Admin-only command, called after the gateway has checked pcs_admin_chats.
// A quote is saved before it is sent, so retries do not invent or change money.
export async function bookingAdminText(m:any){
  const text=String(m?.text||'').trim();
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
