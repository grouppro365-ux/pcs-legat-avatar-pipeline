const CUSTOMER_CONTENT = [
  'text', 'caption', 'photo', 'document', 'video', 'voice', 'audio',
  'animation', 'sticker', 'video_note', 'contact', 'location', 'venue',
  'poll', 'dice'
];

export function isServiceOnlyBusinessMessage(update) {
  const message = update?.business_message;
  if (!message?.message_auto_delete_timer_changed) return false;
  return CUSTOMER_CONTENT.every(key => message[key] == null);
}
