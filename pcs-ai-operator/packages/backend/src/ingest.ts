import { normalizeTelegramUpdate } from '@pcs/core';
import { db, aiDraftQueue, queueOptions } from './runtime.js';

function displayName(user: any) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || null;
}
function attachmentRows(message: any) {
  const out: Array<any> = [];
  if (Array.isArray(message.photo) && message.photo.length) { const p = message.photo.at(-1); out.push({ kind:'photo', telegramFileId:p.file_id, fileSize:p.file_size ? BigInt(p.file_size) : null, metadata:{width:p.width,height:p.height} }); }
  if (message.voice) out.push({ kind:'voice', telegramFileId:message.voice.file_id, mimeType:message.voice.mime_type, fileSize:message.voice.file_size ? BigInt(message.voice.file_size) : null, metadata:{duration:message.voice.duration} });
  if (message.document) out.push({ kind:'document', telegramFileId:message.document.file_id, mimeType:message.document.mime_type, fileName:message.document.file_name, fileSize:message.document.file_size ? BigInt(message.document.file_size) : null });
  return out;
}

export async function processTelegramUpdate(updateId: string) {
  const row = await db.telegramUpdate.findUnique({ where:{updateId:BigInt(updateId)} });
  if (!row) throw new Error('Stored Telegram update not found');
  const update = row.payload as any;
  const n = normalizeTelegramUpdate(update);

  if (n.kind === 'business_connection') {
    const c = update.business_connection;
    await db.telegramConnection.upsert({ where:{connectionId:c.id}, update:{ businessUserId:BigInt(c.user.id), userChatId:BigInt(c.user_chat_id), rights:c.rights ?? undefined, enabled:c.is_enabled, connectedAt:new Date(c.date*1000) }, create:{ connectionId:c.id, businessUserId:BigInt(c.user.id), userChatId:BigInt(c.user_chat_id), rights:c.rights ?? undefined, enabled:c.is_enabled, connectedAt:new Date(c.date*1000) } });
  }

  if (n.kind === 'business_message') {
    const m = update.business_message;
    const connection = await db.telegramConnection.findUnique({ where:{connectionId:m.business_connection_id} });
    if (!connection) throw new Error(`Unknown business connection ${m.business_connection_id}`);
    const outgoing = BigInt(m.from?.id ?? -1) === connection.businessUserId;
    const contactUser = outgoing ? (m.chat?.type === 'private' ? { id:m.chat.id, username:m.chat.username, first_name:m.chat.first_name, last_name:m.chat.last_name, language_code:null } : null) : m.from;
    if (!contactUser?.id) throw new Error('Could not resolve contact user from business message');
    const contact = await db.contact.upsert({
      where:{telegramUserId:BigInt(contactUser.id)},
      update:{ username:contactUser.username ?? undefined, name:displayName(contactUser) ?? undefined, language:contactUser.language_code ?? undefined, lastContactAt:new Date(m.date*1000) },
      create:{ telegramUserId:BigInt(contactUser.id), username:contactUser.username, name:displayName(contactUser), language:contactUser.language_code, firstContactAt:new Date(m.date*1000), lastContactAt:new Date(m.date*1000), profile:{create:{facts:{}}} }
    });
    const conversation = await db.conversation.upsert({
      where:{connectionId_chatId:{connectionId:m.business_connection_id, chatId:BigInt(m.chat.id)}},
      update:{contactId:contact.id,lastMessageAt:new Date(m.date*1000), unreadCount:outgoing?undefined:{increment:1}},
      create:{connectionId:m.business_connection_id,chatId:BigInt(m.chat.id),contactId:contact.id,lastMessageAt:new Date(m.date*1000),unreadCount:outgoing?0:1,title:contact.name}
    });
    const existingMessage = await db.message.findUnique({where:{businessConnectionId_telegramMessageId:{businessConnectionId:m.business_connection_id,telegramMessageId:m.message_id}}});
    const message = existingMessage ?? await db.message.create({ data:{ conversationId:conversation.id, telegramMessageId:m.message_id, businessConnectionId:m.business_connection_id, direction:outgoing?'OUT':'IN', status:outgoing?'SENT':'RECEIVED', text:m.text ?? m.caption ?? null, raw:m, sentAt:outgoing?new Date(m.date*1000):null, attachments:{create:attachmentRows(m)} } });
    if (!existingMessage && !outgoing && message.text) await aiDraftQueue.add('draft',{messageId:message.id},{...queueOptions,jobId:`draft:${message.id}`});
  }

  if (n.kind === 'edited_business_message') {
    const m = update.edited_business_message;
    const conversation = await db.conversation.findUnique({where:{connectionId_chatId:{connectionId:m.business_connection_id,chatId:BigInt(m.chat.id)}}});
    if (conversation) {
      const existing = await db.message.findFirst({where:{conversationId:conversation.id,telegramMessageId:m.message_id,deletedAt:null},orderBy:{createdAt:'desc'}});
      if (existing) await db.message.update({where:{id:existing.id},data:{text:m.text ?? m.caption ?? null,raw:m,editedAt:new Date((m.edit_date ?? Math.floor(Date.now()/1000))*1000)}});
    }
  }

  if (n.kind === 'deleted_business_messages') {
    const d = update.deleted_business_messages;
    const ids = d.message_ids ?? [];
    await db.message.updateMany({where:{businessConnectionId:d.business_connection_id,telegramMessageId:{in:ids},deletedAt:null},data:{deletedAt:new Date()}});
  }

  await db.telegramUpdate.update({where:{id:row.id},data:{processedAt:new Date(),error:null}});
}
