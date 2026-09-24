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

const MONTHS={января:1,январь:1,january:1,jan:1,февраля:2,февраль:2,february:2,feb:2,марта:3,март:3,march:3,mar:3,апреля:4,апрель:4,april:4,apr:4,мая:5,май:5,июня:6,июнь:6,june:6,jun:6,июля:7,июль:7,july:7,jul:7,августа:8,август:8,august:8,aug:8,сентября:9,сентябрь:9,september:9,sep:9,октября:10,октябрь:10,october:10,oct:10,ноября:11,ноябрь:11,november:11,nov:11,декабря:12,декабрь:12,december:12,dec:12};
const iso=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const fullYear=(value)=>{const year=Number(value);return year<100?2000+year:year};

// Return date is exclusive: 10–12 November means two rental days.
export function parseRentalRange(text,now=new Date()){
  const value=String(text||'').toLowerCase();
  const separator='\\s*(?:по|до|[-–—]|to)\\s*';
  const today=now.toISOString().slice(0,10);
  let start='',end='',explicitYear=false;
  let match=value.match(new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2})${separator}(\\d{4}-\\d{2}-\\d{2})\\b`,'u'));
  if(match){start=match[1];end=match[2];explicitYear=true}
  if(!match){
    match=value.match(new RegExp(`\\b(\\d{1,2})[./-](\\d{1,2})(?:[./-](\\d{2,4}))?${separator}(\\d{1,2})[./-](\\d{1,2})(?:[./-](\\d{2,4}))?\\b`,'u'));
    if(match){
      const sm=Number(match[2]),em=Number(match[5]);
      const sy=match[3]?fullYear(match[3]):match[6]?fullYear(match[6])-(em<sm?1:0):now.getUTCFullYear();
      const ey=match[6]?fullYear(match[6]):sy+(em<sm?1:0);
      start=iso(sy,sm,Number(match[1]));end=iso(ey,em,Number(match[4]));explicitYear=Boolean(match[3]||match[6]);
    }
  }
  if(!match){
    const names=Object.keys(MONTHS).join('|');
    match=value.match(new RegExp(`\\b(\\d{1,2})\\s*(?:по|до|[-–—]|to)\\s*(\\d{1,2})\\s*(${names})(?:\\s+(\\d{4}))?(?![\\p{L}\\p{N}])`,'iu'));
    if(match){const year=match[4]?Number(match[4]):now.getUTCFullYear();const month=MONTHS[match[3].toLowerCase()];start=iso(year,month,Number(match[1]));end=iso(year,month,Number(match[2]));explicitYear=Boolean(match[4])}
  }
  if(!match)return null;
  if(!rentalDate(start)||!rentalDate(end))return null;
  if(!explicitYear&&end<today){
    const bump=(date)=>iso(Number(date.slice(0,4))+1,Number(date.slice(5,7)),Number(date.slice(8,10)));
    start=bump(start);end=bump(end);
    if(!rentalDate(start)||!rentalDate(end))return null;
  }
  const days=rentalDays(start,end);
  if(!days||start<today)return null;
  return{start,end,duration:rentalDurationLabel(days)};
}
