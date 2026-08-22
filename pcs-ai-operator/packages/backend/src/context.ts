import { db } from './runtime.js';
import { getRelevantKnowledge } from './knowledge.js';
import { classifyIntent } from '@pcs/core';

export async function buildConversationContext(messageId: string) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { contact: { include: { profile:true } } } } } });
  if (!message || !message.text) throw new Error('Source message not found or has no text');
  const recent = await db.message.findMany({ where:{conversationId:message.conversationId, deletedAt:null}, orderBy:{createdAt:'desc'}, take:20 });
  const intent = classifyIntent(message.text);
  const knowledge = await getRelevantKnowledge(intent, message.text);
  return {
    message,
    conversation: message.conversation,
    contact: message.conversation.contact,
    intent,
    ai: {
      inboundText: message.text,
      language: message.conversation.contact.language,
      summary: message.conversation.summary ?? message.conversation.contact.summary,
      facts: message.conversation.contact.profile?.facts ?? {},
      recentMessages: recent.reverse().map(m => ({direction:m.direction, text:m.text})),
      knowledge
    }
  };
}
