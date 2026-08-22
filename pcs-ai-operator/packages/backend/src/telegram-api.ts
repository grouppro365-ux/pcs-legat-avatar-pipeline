import { config } from './runtime.js';

async function telegram<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json() as any;
  if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
  return payload.result as T;
}

export function telegramGetMe() { return telegram<Record<string, unknown>>('getMe'); }
export function telegramGetWebhookInfo() { return telegram<Record<string, unknown>>('getWebhookInfo'); }
export function telegramSetWebhook() {
  return telegram<boolean>('setWebhook', {
    url: config.telegramWebhookUrl,
    secret_token: config.telegramWebhookSecret,
    allowed_updates: ['business_connection','business_message','edited_business_message','deleted_business_messages'],
    drop_pending_updates: false
  });
}
export function telegramSendBusinessMessage(input: { businessConnectionId: string; chatId: string; text: string }) {
  return telegram<any>('sendMessage', { business_connection_id: input.businessConnectionId, chat_id: input.chatId, text: input.text });
}
