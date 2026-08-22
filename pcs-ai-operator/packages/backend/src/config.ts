export interface Config {
  databaseUrl: string; redisUrl: string; telegramBotToken: string; telegramWebhookSecret: string; telegramWebhookUrl: string;
  openrouterApiKey: string; openrouterBaseUrl: string; aiModel: string; aiFallbackModel: string;
  authSecret: string; appUrl: string; apiUrl: string; defaultTimezone: string; defaultAutoSend: boolean; minimumConfidence: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(options: { allowPlaceholderSecrets?: boolean } = {}): Config {
  const allow = options.allowPlaceholderSecrets ?? false;
  const secret = (name: string) => allow ? (process.env[name] ?? '') : required(name);
  return {
    databaseUrl: required('DATABASE_URL'), redisUrl: required('REDIS_URL'), telegramBotToken: secret('TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret: secret('TELEGRAM_WEBHOOK_SECRET'), telegramWebhookUrl: secret('TELEGRAM_WEBHOOK_URL'),
    openrouterApiKey: secret('OPENROUTER_API_KEY'), openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    aiModel: process.env.AI_MODEL ?? 'openai/gpt-5-mini', aiFallbackModel: process.env.AI_FALLBACK_MODEL ?? 'openai/gpt-4.1-mini',
    authSecret: secret('AUTH_SECRET'), appUrl: process.env.APP_URL ?? 'http://localhost:3000', apiUrl: process.env.API_URL ?? 'http://localhost:3001',
    defaultTimezone: process.env.PCS_DEFAULT_TIMEZONE ?? 'Asia/Bangkok', defaultAutoSend: (process.env.PCS_AUTOSEND ?? 'false') === 'true',
    minimumConfidence: Number(process.env.PCS_MIN_CONFIDENCE ?? '0.90')
  };
}
