// Canonical message contract shared by every inbound channel adapter.
export function hubMessage({ channel, account = '', conversationId, externalUserId, messageId, timestamp = null, language = null, text = '', attachments = [], replyTo = null, raw = null, kind = 'text', name = null }) {
  return {
    channel: String(channel || '').toLowerCase(),
    account: String(account || ''),
    conversation_id: String(conversationId || externalUserId || ''),
    external_user_id: String(externalUserId || ''),
    message_id: String(messageId || ''),
    timestamp: timestamp ? Number(timestamp) : null,
    language: language || null,
    text: String(text || '').trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    reply_to: replyTo || null,
    kind: String(kind || 'text'),
    name: name || null,
    raw,
  };
}

export function hasMessageIdentity(message) {
  return Boolean(message?.channel && message?.external_user_id && message?.message_id && message?.text);
}
