import { db } from './runtime.js';
import { telegramSendBusinessMessage } from './telegram-api.js';

export async function sendOperatorMessage(conversationId: string, text: string, actor = 'operator') {
  const clean = text.trim();
  if (!clean) throw new Error('Message text is required');
  if (clean.length > 4096) throw new Error('Telegram message exceeds 4096 characters');
  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, include: { connection: true } });
  if (!conversation) throw new Error('Conversation not found');
  if (!conversation.connection.enabled) throw new Error('Telegram Business connection is disabled');
  const sent = await telegramSendBusinessMessage({ businessConnectionId: conversation.connectionId, chatId: conversation.chatId.toString(), text: clean });
  const message = await db.message.upsert({
    where: { businessConnectionId_telegramMessageId: { businessConnectionId: conversation.connectionId, telegramMessageId: sent.message_id } },
    update: { text: clean, raw: sent, status: 'SENT', sentAt: new Date((sent.date ?? Math.floor(Date.now()/1000))*1000) },
    create: { conversationId, telegramMessageId: sent.message_id, businessConnectionId: conversation.connectionId, direction: 'OUT', status: 'SENT', text: clean, raw: sent, sentAt: new Date((sent.date ?? Math.floor(Date.now()/1000))*1000) }
  });
  await db.$transaction([
    db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), unreadCount: 0 } }),
    db.auditLog.create({ data: { actor, action: 'operator sent response', entityType: 'message', entityId: message.id } })
  ]);
  return message;
}
