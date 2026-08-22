export type TelegramBusinessKind = 'business_connection' | 'business_message' | 'edited_business_message' | 'deleted_business_messages' | 'unsupported';

export interface NormalizedTelegramUpdate {
  updateId: number;
  kind: TelegramBusinessKind;
  businessConnectionId?: string;
  chatId?: number;
  messageId?: number;
  fromUserId?: number;
  text?: string;
  raw: Record<string, unknown>;
}

export function detectBusinessKind(update: Record<string, any>): TelegramBusinessKind {
  if (update.business_connection) return 'business_connection';
  if (update.business_message) return 'business_message';
  if (update.edited_business_message) return 'edited_business_message';
  if (update.deleted_business_messages) return 'deleted_business_messages';
  return 'unsupported';
}

export function normalizeTelegramUpdate(update: Record<string, any>): NormalizedTelegramUpdate {
  if (!Number.isInteger(update.update_id)) throw new Error('Telegram update_id is required');
  const kind = detectBusinessKind(update);
  const message = update.business_message ?? update.edited_business_message;
  const deleted = update.deleted_business_messages;
  const connection = update.business_connection;
  return {
    updateId: update.update_id,
    kind,
    businessConnectionId: message?.business_connection_id ?? deleted?.business_connection_id ?? connection?.id,
    chatId: message?.chat?.id,
    messageId: message?.message_id,
    fromUserId: message?.from?.id,
    text: message?.text ?? message?.caption,
    raw: update
  };
}
