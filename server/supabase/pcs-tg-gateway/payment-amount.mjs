// The booking snapshot stays in THB. Only the transfer amount is converted.
export function transferAmountLine(amountThb, route) {
  const amount=Number(amountThb), rate=Number(route?.exchange_rate_from_thb);
  if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(rate)||rate<=0)
    throw new Error('payment_conversion_invalid');
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
  if(route.payment_currency==='THB'&&rate===1)return `К переводу: ${fmt(amount)} THB.`;
  if(route.payment_currency!=='RUB')throw new Error('payment_currency_unsupported');
  const converted=Math.round((amount*rate+Number.EPSILON)*100)/100;
  if(!Number.isFinite(converted)||converted<=0)throw new Error('payment_conversion_invalid');
  return `При оплате в рублях: ${fmt(converted)} RUB. Курс: 1 THB = ${fmt(rate)} RUB. Это предоплата в счёт аренды, не залог за сохранность.`;
}
