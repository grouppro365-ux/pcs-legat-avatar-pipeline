import { Prisma } from '@prisma/client';
import { decidePolicy } from '@pcs/core';
import { buildConversationContext } from './context.js';
import { generateAi } from './ai-provider.js';
import { autoEligibility } from './automation.js';
import { db, config, messageSendQueue, queueOptions } from './runtime.js';

const ALLOWED_CRM_FIELDS = new Set(['language','city','country','category','intent','summary','need','budget','deadline','nextAction']);

export async function draftForMessage(messageId: string) {
  const global = await db.automationRule.findUnique({where:{scope:'global'}});
  if (global && !global.enabled) {
    await db.message.update({where:{id:messageId},data:{status:'AWAITING_APPROVAL'}});
    await db.auditLog.create({data:{actor:'system',action:'AI skipped because automation disabled',entityType:'message',entityId:messageId}});
    return null;
  }
  await db.message.update({where:{id:messageId},data:{status:'PROCESSING'}});
  const ctx = await buildConversationContext(messageId);
  try {
    const result = await generateAi(ctx.ai);
    const activeIds = new Set(ctx.ai.knowledge.map(k => k.id));
    const sourceIds = (result.candidate.knowledge_item_ids ?? []).filter(id => activeIds.has(id));
    result.candidate.knowledge_item_ids = sourceIds;
    const eligibility = autoEligibility(global, result.candidate.intent);
    const decision = decidePolicy({ candidate:result.candidate, globalAutoSend:(global?.autoSend ?? config.defaultAutoSend) && eligibility.allowed, minimumConfidence:global?.minimumConfidence ?? config.minimumConfidence, chatMode:ctx.conversation.mode.toLowerCase() as any });
    if (!eligibility.allowed && decision.decision === 'approval' && decision.reason === 'global auto-send disabled') decision.reason = eligibility.reason ?? decision.reason;
    const crm: Record<string,unknown> = {};
    for (const [k,v] of Object.entries(result.candidate.crm_updates ?? {})) if (ALLOWED_CRM_FIELDS.has(k) && v !== undefined && v !== null) crm[k]=v;
    crm.intent = result.candidate.intent;
    if (result.candidate.next_action) crm.nextAction = result.candidate.next_action;
    await db.contact.update({where:{id:ctx.contact.id},data:crm as any});
    const gen = await db.aiGeneration.create({data:{conversationId:ctx.conversation.id,sourceMessageId:messageId,provider:result.provider,model:result.model,intent:result.candidate.intent,confidence:result.candidate.confidence,risk:result.candidate.risk,requiresHuman:result.candidate.requires_human,answer:result.candidate.answer,nextAction:result.candidate.next_action,crmUpdates:(result.candidate.crm_updates ?? {}) as Prisma.InputJsonValue,knowledgeItemIds:sourceIds as Prisma.InputJsonValue,policyDecision:decision.decision,policyReason:decision.reason,status:decision.decision==='auto'?'AUTO_QUEUED':'APPROVAL_REQUIRED'}});
    await db.message.update({where:{id:messageId},data:{status:decision.decision==='auto'?'QUEUED':'AWAITING_APPROVAL'}});
    await db.auditLog.create({data:{actor:'ai',action:'AI generated response',entityType:'ai_generation',entityId:gen.id,payload:{decision:decision.decision,reason:decision.reason}}});
    if (decision.decision === 'auto') await messageSendQueue.add('send',{generationId:gen.id},{...queueOptions,jobId:`send:${gen.id}`});
    return gen;
  } catch (error) {
    await db.message.update({where:{id:messageId},data:{status:'AWAITING_APPROVAL'}});
    await db.auditLog.create({data:{actor:'system',action:'AI generation failed',entityType:'message',entityId:messageId,payload:{error:error instanceof Error?error.message:String(error)}}});
    throw error;
  }
}
