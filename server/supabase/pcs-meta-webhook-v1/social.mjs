const LANGUAGE_CODES = new Set(['ru', 'en', 'th']);

export function languageOf(text) {
  if (/[\u0E00-\u0E7F]/u.test(text)) return 'th';
  if (/[\u0400-\u04FF]/u.test(text)) return 'ru';
  return 'en';
}

export function languageForMessage(text, previousLanguage) {
  if (/[\p{L}\p{N}]/u.test(text)) return languageOf(text);
  return LANGUAGE_CODES.has(previousLanguage) ? previousLanguage : 'ru';
}

export function socialIntent(text) {
  const value = String(text || '').trim();
  if (!value) return null;

  // For emoji-only messages, answer deterministically and preserve the meaning
  // instead of sending a vague "not understood" response through the LLM.
  if (!/[\p{L}\p{N}]/u.test(value)) {
    if (/[\u{1F91D}\u{1F64F}\u2764\u{1F49C}\u{1F499}\u{1F49A}\u{1F9E1}\u{1F90D}\u{1F90E}]/u.test(value)) return 'thanks';
    if (/[\u{1F44D}\u{1F44C}\u2705]/u.test(value)) return 'ack';
    return 'greeting';
  }

  const normalized = value.toLocaleLowerCase().replace(/[!?.…,;:()\[\]{}'"`~*_\-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:спасибо|благодарю|спасибо за сотрудничество|thank you|thanks|many thanks|ขอบคุณ|ขอบคุณครับ|ขอบคุณค่ะ)$/u.test(normalized)) return 'thanks';
  if (/^(?:привет|здравствуйте|добрый день|доброе утро|добрый вечер|hi|hello|hey|good morning|good afternoon|good evening|สวัสดี|สวัสดีครับ|สวัสดีค่ะ)$/u.test(normalized)) return 'greeting';
  if (/^(?:ок|хорошо|понятно|принято|договорились|ok|okay|got it|understood|ตกลง|โอเค)$/u.test(normalized)) return 'ack';
  return null;
}

export function socialReply(language, intent) {
  const replies = {
    ru: {
      greeting: 'Здравствуйте! Рады приветствовать вас в PCS. Чем можем помочь?',
      thanks: 'Спасибо за доверие и сотрудничество! Рады быть полезными.',
      ack: 'Принято, спасибо! Если понадобится помощь, мы рядом.',
    },
    en: {
      greeting: 'Hello! Welcome to PCS. How can we help?',
      thanks: 'Thank you for your trust and cooperation. We are happy to help!',
      ack: 'Got it, thank you! We are here if you need anything else.',
    },
    th: {
      greeting: 'สวัสดีค่ะ ยินดีต้อนรับสู่ PCS มีอะไรให้เราช่วยได้บ้างคะ',
      thanks: 'ขอบคุณสำหรับความไว้วางใจและความร่วมมือค่ะ เรายินดีให้บริการเสมอ',
      ack: 'รับทราบค่ะ ขอบคุณ หากต้องการความช่วยเหลือเพิ่มเติม แจ้งเราได้เสมอค่ะ',
    },
  };
  const selected = replies[LANGUAGE_CODES.has(language) ? language : 'ru'];
  return selected[intent] || selected.greeting;
}
