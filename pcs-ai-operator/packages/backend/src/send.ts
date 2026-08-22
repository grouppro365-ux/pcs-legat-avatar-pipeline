import { db } from './runtime.js';
import { telegramSendBusinessMessage } from './telegram-api.js';

export async function sendGeneration(generationId: string, actor = 'system') {
  const gen = await db.aiGeneration.findUnique({where:{id:generationId},include:{conversation:true,sourceMessage:true}});
  if (!gen) throw new Error('AI generation not found');
  if (gen.status === 'SENT') return gen;
  const sent = await telegramSendBusinessMessage({businessConnectionId:gen.sourceMessage.businessConnectionId,chatId:gen.conversation.chatId.toString(),text:gen.answer});
  await db.$transaction([
    db.message.upsert({where:{businessConnectionId_telegramMessageId:{businessConnectionId:gen.sourceMessage.businessConnectionId,telegramMessageId:sent.message_id}},update:{text:gen.answer,raw:sent,status:'SENT',sentAt:new Date((sent.date ?? Math.floor(Date.now()/1000))*1000)},create:{conversationId:gen.conversationId,telegramMessageId:sent.message_id,businessConnectionId:gen.sourceMessage.businessConnectionId,direction:'OUT',status:'SENT',text:gen.answer,raw:sent,sentAt:new Date((sent.date ?? Math.floor(Date.now()/1000))*1000)}}),
    db.aiGeneration.update({where:{id:gen.id},data:{status:'SENT'}}),
    db.message.update({where:{id:gen.sourceMessageId},data:{status:'SENT'}}),
    db.conversation.update({where:{id:gen.conversationId},data:{lastMessageAt:new Date(),unreadCount:0}}),
    db.auditLog.create({data:{actor,action:actor==='ai'?'auto-response sent':'operator sent response',entityType:'ai_generation',entityId:gen.id}})
  ]);
  return gen;
}
