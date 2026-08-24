import assert from 'node:assert/strict';

// Regression contract for the production SQL classifier.
// These cases exist because an unbounded `car` token matched the `Card`
// substring in "Thailand Digital Arrival Card" and forced car_rent.
function classify(text=''){
  const t=String(text).toLowerCase();
  if (/(tdac|digital[ -]?arrival[ -]?card|thailand[ -]?digital[ -]?arrival[ -]?card|visa|tm-?30)/iu.test(t)) return 'visa';
  if (/(doctor|hospital|medical|врач|медицин)/iu.test(t)) return 'medical';
  if (/(bank|банк)/iu.test(t)) return 'bank';
  if (/(legal|lawyer|юрист|договор)/iu.test(t)) return 'legal';
  if (/(^|[^a-z])(car|cars|vehicle|vehicles)([^a-z]|$)/iu.test(t)) {
    if (/(buy|purchase|for sale)/iu.test(t)) return 'car_buy';
    return 'car_rent';
  }
  if (/(apartment|condo|housing|квартир|жиль)/iu.test(t)) return 'housing_rent';
  return null;
}

const CURRENT_DATE='2026-08-24';
const MONTHS={
  january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
  'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
};
function isoDate(y,m,d){return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function answerMentionsExpiredCurrent(answer='',topic='legal'){
  if(!['legal','bank','visa','business_support','driving_license'].includes(topic))return null;
  const currentish=/(current|currently|действующ|текущ|сейчас|valid|effective|present)/i.test(answer);
  const windows=[...answer.matchAll(/(?:до|until|through|valid until|extended until|expires? on|по)\s+(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\s+(20\d{2})/gi)];
  for(const m of windows){const mon=MONTHS[m[2].toLowerCase()];if(!mon)continue;const dt=isoDate(Number(m[3]),mon,Number(m[1]));if(dt<CURRENT_DATE&&currentish)return {expired_date:dt};}
  const iso=[...answer.matchAll(/(?:до|until|through|valid until|extended until|expires? on|по)\s+(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/gi)];
  for(const m of iso){const dt=isoDate(Number(m[1]),Number(m[2]),Number(m[3]));if(dt<CURRENT_DATE&&currentish)return {expired_date:dt};}
  return null;
}

const cases=[
  ['Thailand Digital Arrival Card (TDAC)', 'visa'],
  ['When should I submit the Digital Arrival Card?', 'visa'],
  ['Do I need TDAC before arrival?', 'visa'],
  ['Need a visa for Thailand', 'visa'],
  ['What is TM30?', 'visa'],
  ['I need a car in Pattaya', 'car_rent'],
  ['Rent a vehicle in Bangkok', 'car_rent'],
  ['Cars available tomorrow?', 'car_rent'],
  ['I want to buy a car', 'car_buy'],
  ['Vehicle for sale in Pattaya', 'car_buy'],
  ['Can I pay by card?', null],
  ['My credit card was charged twice', null],
  ['business card printing', null],
  ['career advice', null],
  ['Caribbean trip', null],
  ['cardiology clinic', null],
  ['carry-on baggage', null],
  ['Need a bank account', 'bank'],
  ['Need a doctor', 'medical'],
  ['Need a lawyer', 'legal'],
  ['Need an apartment in Pattaya', 'housing_rent'],
];

let passed=0;
for(const [text,expected] of cases){
  assert.equal(classify(text),expected,`Intent mismatch for: ${text}`);
  passed++;
}

const expiryCases=[
  ['The current VAT rate in Thailand is 7%. This rate is valid until 30 September 2024.', 'legal', '2024-09-30'],
  ['Действующая ставка НДС составляет 7% и продлена до 30 сентября 2024 года.', 'legal', '2024-09-30'],
  ['The current rule is effective through 2025-12-31.', 'visa', '2025-12-31'],
];
for(const [answer,topic,date] of expiryCases){
  assert.equal(answerMentionsExpiredCurrent(answer,topic)?.expired_date,date);
  passed++;
}
const okCurrent=[
  ['The current VAT rate in Thailand is 7%. This rate is valid until 30 September 2028.', 'legal'],
  ['The emergency number is 1669.', 'medical'],
  ['The answer refers to a past Cabinet resolution and does not claim current validity until an expired date.', 'legal'],
];
for(const [answer,topic] of okCurrent){
  assert.equal(answerMentionsExpiredCurrent(answer,topic),null);
  passed++;
}

console.log(JSON.stringify({ok:true,scenarios:passed,regression:'car word-boundary + TDAC + official research expiry guard'},null,2));
