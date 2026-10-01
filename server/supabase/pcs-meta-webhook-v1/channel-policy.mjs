// Every normalized channel that reaches this webhook must enter the same
// Conversation Hub decision path. Channel-specific code is limited to the
// transport adapter (signature parsing and outbound delivery). LINE retains
// its existing signed receiver until its separate end-to-end check is passed.
export const AUTOMATED_HUB_CHANNELS = new Set(['instagram', 'whatsapp', 'facebook']);

export function shouldGenerateCustomerReply(channel, savedMessage) {
  return Boolean(savedMessage) && AUTOMATED_HUB_CHANNELS.has(String(channel || '').toLowerCase());
}

export function mayAutoSendHubReply({ localDraft = false, connection, generated, risk, replyMode }) {
  return Boolean(!localDraft && connection?.enabled && connection?.status === 'active' && replyMode === 'auto'
    && generated.autoSend && !risk && generated.model !== 'safe-fallback');
}

export function mayQueueLocalReply({ config, connection, row, generated, risk }) {
  if (config?.enabled !== true || config?.outgoing_enabled !== true ||
      typeof config.outgoing_since !== 'string' || row?.account !== `instagrapi:${config.account_id}`) return false;
  const since = Date.parse(config.outgoing_since);
  const timestamp = row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp;
  const recipient = String(row.external_user_id || '').split(':').at(-1);
  if (!Number.isFinite(since) || !Number.isFinite(timestamp) || timestamp < since ||
      (Array.isArray(config.pilot_recipient_ids) && !config.pilot_recipient_ids.includes(recipient)) ||
      Number(generated?.confidence) < 0.9 || !Number.isFinite(Number(generated?.confidence))) return false;
  return mayAutoSendHubReply({ localDraft: false, connection,
    generated, risk, replyMode: connection?.public_config?.reply_mode });
}

