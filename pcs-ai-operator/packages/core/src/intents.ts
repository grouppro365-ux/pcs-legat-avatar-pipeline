export const INTENTS = [
  'housing_rent','housing_buy','car_rent','car_buy','bike_rent','visa','bank','legal','medical','dentistry',
  'education','translation','cleaning','repair','internet','transfer','delivery','tour','yacht','business_support',
  'emergency','partnership','complaint','other'
] as const;
export type Intent = typeof INTENTS[number];

const patterns: Array<[Intent, RegExp]> = [
  ['car_rent', /(аренд\w*\s+(машин|авто)|машин\w*.*в\s+аренд|авто\w*.*в\s+аренд|rent\s+(a\s+)?car|car\s+rent|เช่ารถ)/i],
  ['car_buy', /(купить\s+(машин|авто)|buy\s+(a\s+)?car|ซื้อรถ)/i],
  ['housing_rent', /(аренд\w*\s+(квартир|дом|жиль)|rent\s+(apartment|condo|house)|เช่า(คอนโด|บ้าน))/i],
  ['housing_buy', /(купить\s+(квартир|дом|жиль)|buy\s+(apartment|condo|house)|ซื้อ(คอนโด|บ้าน))/i],
  ['bike_rent', /(байк|скутер|motorbike|scooter|มอเตอร์ไซค์)/i],
  ['visa', /(виз|visa|วีซ่า|dtv|ltr|tm-?30|retirement)/i],
  ['bank', /(банк|сч[её]т|bank\s+account|ธนาคาร)/i],
  ['legal', /(юрист|договор|legal|lawyer|กฎหมาย|สัญญา)/i],
  ['medical', /(врач|клиник|медицин|doctor|hospital|โรงพยาบาล)/i],
  ['dentistry', /(стомат|зуб|dentist|dental|ทันต)/i],
  ['translation', /(переводчик|translator|interpreter|ล่าม)/i],
  ['transfer', /(трансфер|transfer|airport\s+pickup|รับส่ง)/i],
  ['tour', /(экскурс|tour|ทัวร์)/i],
  ['yacht', /(яхт|yacht|เรือยอชท์)/i],
  ['partnership', /(партн[её]р|сотрудничеств|partner|partnership|ร่วมมือ)/i],
  ['complaint', /(жалоб|претензи|недоволен|complaint|refund|คืนเงิน)/i],
  ['emergency', /(срочно|экстренн|emergency|urgent|ด่วน)/i]
];

export function classifyIntent(text: string): Intent {
  for (const [intent, pattern] of patterns) if (pattern.test(text)) return intent;
  return 'other';
}
