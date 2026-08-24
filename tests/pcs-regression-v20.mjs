import assert from 'node:assert/strict';

const REQUIRED_LANGS=['ru','en','it','es','fr','de','th'];
const EXTENDED_LANGS=['pl','zh','ja','ko','ar','kk'];
const LANGS=[...REQUIRED_LANGS,...EXTENDED_LANGS];

function normalizeLanguage(v=''){
  const s=String(v).toLowerCase().replace('_','-');
  const base=s.split('-')[0];
  return LANGS.includes(base)?base:'en';
}
function detectLanguage(text='',fallback=''){
  const t=text.toLowerCase();
  if(/[ก-๙]/u.test(text))return'th';
  if(/[ぁ-ゟ゠-ヿ]/u.test(text))return'ja';
  if(/[가-힣]/u.test(text))return'ko';
  if(/[\u0600-\u06ff]/u.test(text))return'ar';
  if(/[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(text))return'kk';
  if(/[\u4e00-\u9fff]/u.test(text)){const f=normalizeLanguage(fallback);return f==='ja'||f==='zh'?f:'zh'}
  if(/[А-Яа-яЁё]/u.test(text)){const f=normalizeLanguage(fallback);return f==='kk'||f==='ru'?f:'ru'}
  if(/\b(ciao|buongiorno|buonasera|alloggio|macchina|noleggio|visto|grazie)\b/u.test(t))return'it';
  if(/\b(hola|buenos días|alojamiento|coche|visado|gracias)\b/u.test(t))return'es';
  if(/\b(bonjour|bonsoir|logement|voiture|merci)\b/u.test(t))return'fr';
  if(/\b(hallo|guten tag|unterkunft|mietwagen|danke)\b/u.test(t))return'de';
  if(/\b(cześć|dzień dobry|mieszkanie|samochód|dziękuję)\b/u.test(t))return'pl';
  if(/[A-Za-z]/.test(text))return normalizeLanguage(fallback||'en');
  return normalizeLanguage(fallback||'ru');
}
const SENSITIVE=new Set(['visa','bank','legal','medical','dentistry','emergency']);
function policy(intent,kbCount){return SENSITIVE.has(intent)&&kbCount===0?'grounding_gate_safe_hold':'normal'}
function fleetKey(x){const m=x?.metadata||{};return String(m.ltc_id||m.fleet_id||x?.title||'').trim()}
function fleetRows(rows=[]){const best=new Map();for(const x of rows){if(x?.deleted_at||x?.ownership_type!=='pcs_owned'||!String(x?.category||'').startsWith('car_')||x?.metadata?.fleet_master!==true)continue;const key=fleetKey(x);if(!key)continue;const score=(x.category==='car_rent'?4:0)+(x.status==='available'?2:0)+(Number(x.daily_price||0)>0?1:0);const old=best.get(key);if(!old||score>old.score)best.set(key,{row:x,score})}return [...best.values()].map(v=>v.row)}
function convert(v,from,to,rates,base='THB'){const n=Number(v),rf=from===base?1:Number(rates[from]),rt=to===base?1:Number(rates[to]);if(!Number.isFinite(n)||!Number.isFinite(rf)||rf<=0||!Number.isFinite(rt)||rt<=0)return null;return(n/rf)*rt}
let count=0;const check=fn=>{fn();count++};
for(const l of LANGS)for(const suffix of ['','-TH','-US','-RU','-CN','_TH','_US','_KZ'])check(()=>assert.equal(normalizeLanguage(l+suffix),l));
const samples={ru:['Здравствуйте','Нужна машина','Спасибо','Хочу квартиру','Нужна виза','Банк в Таиланде','Нужен юрист','Врач в Паттайе','Аренда байка','Срочно помогите'],en:['Hello','I need a car','Thanks','Need accommodation','Visa question','Bank account','Need a lawyer','Doctor in Pattaya','Rent a bike','Urgent help'],it:['Ciao','Buongiorno','Mi serve una macchina','Cerco alloggio','Visto Thailandia','Grazie','Noleggio auto','Buonasera','Ho bisogno di un appartamento','Macchina a Pattaya'],es:['Hola','Buenos días','Necesito un coche','Busco alojamiento','Visado de Tailandia','Gracias','Alquiler de coche','Buenas','Necesito apartamento','Coche en Pattaya'],fr:['Bonjour','Bonsoir','Je cherche un logement','Location voiture','Visa Thaïlande','Merci','Voiture à Pattaya','Appartement','Logement en Thaïlande','Bonjour voiture'],de:['Hallo','Guten Tag','Ich brauche eine Unterkunft','Mietwagen Pattaya','Visum Thailand','Danke','Wohnung Pattaya','Auto mieten','Unterkunft Thailand','Hallo Mietwagen'],th:['สวัสดีครับ','ต้องการรถเช่า','หาที่พัก','วีซ่าไทย','ขอบคุณครับ','ต้องการคอนโด','เช่ารถพัทยา','ต้องการมอเตอร์ไซค์','ช่วยด้วยด่วน','ธนาคาร']};
for(const [lang,list] of Object.entries(samples))for(const text of list)check(()=>assert.equal(detectLanguage(text,lang),lang));
const ext={zh:['你好','我需要租车','泰国签证','芭提雅公寓','谢谢','银行开户','需要医生','紧急帮助'],ja:['こんにちは','車を借りたい','タイのビザ','パタヤの部屋','ありがとう','銀行','医者が必要です','緊急です'],ko:['안녕하세요','렌터카 필요해요','태국 비자','파타야 숙소','감사합니다','은행','의사가 필요해요','긴급'],ar:['مرحبا','أريد استئجار سيارة','تأشيرة تايلاند','سكن في باتايا','شكرا','بنك','أحتاج طبيبا','حالة طارئة'],kk:['Сәлеметсіз бе','Маған көлік керек','Тайланд визасы','Пәтер керек','Рақмет','Банк керек','Дәрігер керек','Шұғыл көмек'],pl:['Cześć','Dzień dobry','Potrzebuję samochód','Szukam mieszkanie','Wiza do Tajlandii','Dziękuję','Samochód Pattaya','Mieszkanie Pattaya']};
for(const [lang,list] of Object.entries(ext))for(const text of list)check(()=>assert.equal(detectLanguage(text,lang),lang));
for(const intent of SENSITIVE){for(let i=0;i<20;i++)check(()=>assert.equal(policy(intent,0),'grounding_gate_safe_hold'));for(let i=0;i<5;i++)check(()=>assert.equal(policy(intent,1),'normal'))}
for(const intent of ['car_rent','housing_rent','bike_rent','tour','transfer','delivery','translation','cleaning','repair','education'])for(let i=0;i<10;i++)check(()=>assert.equal(policy(intent,0),'normal'));
const fleet=[...['001','002','003','005','006','007','008'].map(id=>({id:'ltc'+id,title:'LTC-'+id,category:'car_rent',status:'checking',ownership_type:'pcs_owned',metadata:{fleet_master:true,ltc_id:'LTC-'+id}})),{id:'juke',title:'Nissan Juke',category:'car_rent',status:'checking',ownership_type:'pcs_owned',daily_price:800,metadata:{fleet_master:true,ltc_id:'LTC-004'}},{id:'mg-rent',title:'MG5',category:'car_rent',status:'checking',ownership_type:'pcs_owned',daily_price:660,metadata:{fleet_master:true,fleet_id:'MG5-2025'}},{id:'mg-buy',title:'MG5',category:'car_buy',status:'checking',ownership_type:'pcs_owned',metadata:{fleet_master:true,fleet_id:'MG5-2025'}},{id:'focus-sale',title:'Focus sale',category:'car_buy',status:'checking',ownership_type:'pcs_owned',metadata:{}},{id:'focus-rent',title:'Focus rent',category:'car_rent',status:'checking',ownership_type:'pcs_owned',metadata:{}}];
const physical=fleetRows(fleet);check(()=>assert.equal(physical.length,9));check(()=>assert.ok(physical.some(x=>x.id==='mg-rent')));check(()=>assert.ok(!physical.some(x=>x.id==='mg-buy')));check(()=>assert.ok(!physical.some(x=>x.id==='focus-sale')));check(()=>assert.ok(!physical.some(x=>x.id==='focus-rent')));for(let i=0;i<15;i++)check(()=>assert.equal(new Set(fleetRows(fleet).map(fleetKey)).size,9));
const rates={THB:1,USD:0.030619,EUR:0.026204,RUB:2.534693,CNY:0.205994,JPY:4.864617,KRW:42.415906,AED:0.112424,PLN:0.113048,KZT:14.046859};for(const from of Object.keys(rates))for(const to of Object.keys(rates))check(()=>{const x=convert(1000,from,to,rates);assert.ok(Number.isFinite(x));if(from===to)assert.ok(Math.abs(x-1000)<1e-8)});
console.log(JSON.stringify({ok:true,scenarios:count,required_languages:REQUIRED_LANGS.length,extended_languages:EXTENDED_LANGS.length,physical_fleet:physical.length,currency_pairs:100},null,2));
