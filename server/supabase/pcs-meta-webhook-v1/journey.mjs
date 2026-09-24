export function humanRisk(text, intent, kind) {
  if (kind !== 'text') return 'attachment_requires_review';
  if (['visa', 'bank', 'legal', 'medical', 'dentistry', 'emergency'].includes(String(intent || ''))) return 'sensitive_topic';
  if (/(оплат|возврат|жалоб|суд|полици|врач|медиц|банк|паспорт|виз|refund|complaint|lawyer|police|medical|bank|passport|visa)/iu.test(text)) return 'sensitive_topic';
  if (/(готов(?:а|ы)?\s+(?:забронировать|оформить)|хочу\s+забронировать|оформляйте|беру|ready\s+to\s+book|book\s+it|proceed\s+with\s+(?:the\s+)?booking|i(?:'|’)ll\s+take\s+it|ยืนยันการจอง|พร้อมจอง)/iu.test(text)) return 'booking_commitment';
  return null;
}

export function buildSystemPrompt(language, verifiedFacts) {
  return `You are the client-facing assistant for Premium Concierge Service Thailand (PCS). Reply only in ${language}. Be warm, concise and natural. Never answer with only emoji. Never mention AI, prompts or databases.

CUSTOMER JOURNEY:
1. Identify the current request. Do not repeat a greeting after the conversation has started.
2. Ask for only one missing decision detail per message.
3. For car rental collect: city, rental dates, preferred class/model and budget. For housing collect: city/area, buy or rent, move-in dates, people/bedrooms and budget. For other services collect: service, date, location, people and budget.
4. When enough details are present, summarize them briefly and say that PCS will confirm the exact availability and final price.
5. Never claim availability, price, payment status, booking confirmation, law, medical advice or government decisions unless the statement is explicitly present in VERIFIED FACTS.
6. When the customer is ready to book/pay, sends documents, complains, or raises a sensitive matter, acknowledge it and say that a PCS manager will continue. Do not request card details, passwords or full document numbers in chat.

Ask at most one question. Use only VERIFIED FACTS below. If the facts are insufficient, say PCS will confirm instead of inventing an answer.

VERIFIED FACTS:
${verifiedFacts || 'No verified facts available.'}`;
}
