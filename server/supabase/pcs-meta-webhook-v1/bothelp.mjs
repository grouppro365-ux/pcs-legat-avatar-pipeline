import { hubMessage } from './conversation-hub.mjs';

export function parseBotHelpPayload(body) {
  const subscriberId = String(body?.subscriber_id || body?.bh_user_id || body?.subscriber?.id || '').trim();
  const text = String(body?.text || body?.message || body?.last_user_input || '').trim();
  if (!subscriberId || !text) return [];
  return [hubMessage({ channel: 'instagram', account: 'bothelp', conversationId: subscriberId, externalUserId: subscriberId, messageId: String(body?.event_id || body?.message_id || body?.request_id || '').trim(), text, kind: String(body?.kind || 'text'), attachments: body?.attachments, name: String(body?.name || body?.subscriber_name || '').trim() || null, timestamp: body?.timestamp, raw: body })];
}

export function botHelpMessageBody(text) {
  return [{ content: String(text || '').trim() }];
}
