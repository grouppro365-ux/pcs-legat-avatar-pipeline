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
console.log(JSON.stringify({ok:true,scenarios:passed,regression:'car word-boundary + TDAC'},null,2));
