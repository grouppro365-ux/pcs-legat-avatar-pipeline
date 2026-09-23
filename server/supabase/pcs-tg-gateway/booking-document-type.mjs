export function bookingDocumentType(caption) {
  const text = String(caption || '').trim();
  if (/\b(?:idp|international driving permit)\b|мву|международн.{0,20}(?:водительск|прав|удостоверен)/iu.test(text)) return 'international_permit';
  if (/паспорт|загран|passport/iu.test(text)) return 'passport';
  if (/чек|квитанц|предоплат|receipt|payment proof/iu.test(text)) return 'receipt';
  return 'booking_document_unknown';
}
