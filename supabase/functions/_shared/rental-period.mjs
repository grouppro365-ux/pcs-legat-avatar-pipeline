// Rental quotes and booking conflicts both use [pickup date, return date).
const DAY=86400000;
export function rentalDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
export function rentalEnd(start,duration){
  const date=rentalDate(start);if(!date)return '';
  const text=String(duration||'').trim().toLowerCase();
  const count=Number(text.match(/\d+/)?.[0]||1);
  if(!Number.isSafeInteger(count)||count<=0)return '';
  if(/мес|month/u.test(text)){
    const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+count);
    const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    date.setUTCDate(Math.min(day,last));
  }else if(/нед|week/u.test(text))date.setTime(date.getTime()+count*7*DAY);
  else if(/дн|день|сут|day/u.test(text))date.setTime(date.getTime()+count*DAY);
  else return '';
  return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';
}
export function rentalDays(start,end){
  const a=rentalDate(start),b=rentalDate(end);
  return a&&b&&b>a?(b-a)/DAY:null;
}
export function rentalDurationLabel(days){
  const tail=days%100,unit=tail>=11&&tail<=14?'дней':days%10===1?'день':days%10>=2&&days%10<=4?'дня':'дней';
  return days+' '+unit;
}
