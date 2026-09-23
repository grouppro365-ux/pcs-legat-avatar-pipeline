const LEFT = '(?:^|[^\\p{L}\\p{N}])';
const RIGHT = '(?=$|[^\\p{L}\\p{N}])';
const FIESTA = new RegExp(`${LEFT}(?:ford\\s+)?fiesta${RIGHT}|фиест[аыу]?`, 'iu');
const FOCUS = new RegExp(`${LEFT}(?:ford\\s+)?focus${RIGHT}|фокус[аыу]?`, 'iu');
const MG5 = new RegExp(`${LEFT}(?:mg\\s*)?mg\\s*5${RIGHT}|мг\\s*5`, 'iu');

export function specificVehicleModel(text) {
  const value = String(text || '');
  if (FIESTA.test(value)) return 'Fiesta';
  if (FOCUS.test(value)) return 'Focus';
  if (MG5.test(value)) return 'MG5';
  return '';
}

export function specificVehicleIntent(text) {
  if (!specificVehicleModel(text)) return '';
  return /(?:купить|покупк|приобрест|buy|purchase)/iu.test(String(text)) ? 'car_buy' : 'car_rent';
}
