export function bookingConfirmationText(request, title, publicId, language = 'ru') {
  const total=Number(request?.rental_total),paid=Number(request?.booking_deposit_amount);
  if(request?.status!=='booked'||!Number.isFinite(total)||total<=0||
     !Number.isFinite(paid)||paid<=0||paid>total||
     !/^\d{4}-\d{2}-\d{2}$/.test(String(request?.start_date||''))||
     !/^\d{4}-\d{2}-\d{2}$/.test(String(request?.end_date||'')))throw Error('booking_confirmation_snapshot_invalid');
  const name=String(title||'автомобиля').replace(/^LTC-\d+\s*·\s*/iu,'').trim();
  const money=n=>new Intl.NumberFormat(language==='ru'?'ru-RU':'en-US').format(n)+' '+(request.currency==='THB'?(language==='ru'?'бат':'THB'):request.currency);
  const reference=publicId?`${language==='ru'?'Номер заявки':'Reference'}: ${publicId}.\n`:'';
  if(language==='ru')return `Бронь ${name} на ${request.start_date} — ${request.end_date} подтверждена.\n${reference}Аренда — ${money(total)}. Предоплата ${money(paid)} получена и учтена в стоимости аренды. Остаток аренды — ${money(total-paid)}.\n\nВремя и место выдачи, залог за сохранность авто и договор согласуем отдельно до передачи машины.`;
  return `Your booking for ${name} from ${request.start_date} to ${request.end_date} is confirmed.\n${reference}Rental: ${money(total)}. We received your advance payment of ${money(paid)} and applied it to the rental. Rental balance: ${money(total-paid)}.\n\nWe will confirm the handover time and place, security deposit and contract separately before delivery.`;
}
