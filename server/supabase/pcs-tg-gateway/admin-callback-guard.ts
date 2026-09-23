import {sb,send,tg} from './common.ts';
import {adminCallback} from './admin.ts';
import {requiresVerifiedBookingFlow} from './booking-action-policy.mjs';

export async function guardedAdminCallback(q:any){
  const chat=q.message?.chat?.id;
  const [action,id]=String(q.data||'').split(':');
  if(!chat||!id)return adminCallback(q);
  let reservation:any=null,finance:any=null;
  if(['bconfirm','bcancel','bpaid'].includes(action)){
    const {data,error}=await sb.from('pcs_reservations').select('id,source').eq('id',id).maybeSingle();
    if(error)throw error;
    reservation=data;
  }else if(['rpay','rreject'].includes(action)){
    const {data,error}=await sb.from('pcs_finance_entries').select('id,payment_kind,metadata,reservation_id').eq('id',id).maybeSingle();
    if(error)throw error;
    finance=data;
    if(data?.reservation_id){
      const linked=await sb.from('pcs_reservations').select('id,source').eq('id',data.reservation_id).maybeSingle();
      if(linked.error)throw linked.error;
      reservation=linked.data;
    }
  }
  if((['bconfirm','bcancel','bpaid'].includes(action)&&!reservation)||(['rpay','rreject'].includes(action)&&!finance)){
    await send(chat,'Запись больше не найдена. Обновите раздел перед действием.');
    try{await tg('answerCallbackQuery',{callback_query_id:q.id})}catch{}
    return;
  }
  if(!requiresVerifiedBookingFlow(action,reservation,finance))return adminCallback(q);
  await send(chat,action.startsWith('b')?'Эту операционную бронь нельзя подтверждать, отменять или отмечать оплаченной старой кнопкой. Сверьте её в PCS и используйте проверенный процесс заявки.':'Оплату этой заявки нельзя менять старой кнопкой. Чек и поступление проверяются отдельно через /breceipt и /bpaid с номером банковской операции.');
  try{await tg('answerCallbackQuery',{callback_query_id:q.id})}catch{}
}
