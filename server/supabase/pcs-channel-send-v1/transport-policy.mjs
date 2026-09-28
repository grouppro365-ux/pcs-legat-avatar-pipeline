export function remoteTransportAllowed(channel, recipientId) {
  return !(channel === 'instagram' && String(recipientId || '').startsWith('instagrapi:'));
}
