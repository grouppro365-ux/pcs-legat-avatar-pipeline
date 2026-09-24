// Every normalized channel that reaches this webhook must enter the same
// Conversation Hub decision path. Channel-specific code is limited to the
// transport adapter (signature parsing and outbound delivery). LINE retains
// its existing signed receiver until its separate end-to-end check is passed.
export const AUTOMATED_HUB_CHANNELS = new Set(['instagram', 'whatsapp', 'facebook']);

export function shouldGenerateCustomerReply(channel, savedMessage) {
  return Boolean(savedMessage) && AUTOMATED_HUB_CHANNELS.has(String(channel || '').toLowerCase());
}
