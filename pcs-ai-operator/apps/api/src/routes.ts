import type { FastifyInstance } from 'fastify';
import { db, redis, config, telegramIngestQueue, queueOptions, telegramGetMe, telegramGetWebhookInfo, telegramSetWebhook, aiDraftQueue, messageSendQueue, sendOperatorMessage, retryFailedJob } from '@pcs/backend';
import { requireAuth } from './auth.js';
import { automationInput, cleanText, contactPatch, conversationPatch, knowledgeInput, objectBody, taskInput } from './validation.js';

const safe = (value:any):any => typeof value==='bigint' ? value.toString() : Array.isArray(value)?value.map(safe):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safe(v)])):value;

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const out:any={backend:'ok',postgres:'fail',redis:'fail',telegram_configuration:Boolean(config.telegramBotToken&&config.telegramWebhookSecret&&config.telegramWebhookUrl),ai_configuration:Boolean(config.openrouterApiKey),worker:'unknown'};
    try { await db.$queryRaw`SELECT 1`; out.postgres='ok'; } catch {}
    try { out.redis=(await redis.ping())==='PONG'?'ok':'fail'; } catch {}
    try { const h=await redis.get('pcs:worker:heartbeat'); out.worker=h && Date.now()-Number(h)<45000?'ok':'stale'; } catch {}
    return out;
  });

  app.post('/telegram/webhook', async (req, reply) => {
    const secret=req.headers['x-telegram-bot-api-secret-token'];
    if (!config.telegramWebhookSecret || secret!==config.telegramWebhookSecret) return reply.code(401).send({ok:false});
    const update=req.body as any;
    if (!Number.isInteger(update?.update_id)) return reply.code(400).send({ok:false,error:'invalid update_id'});
    let created=false;
    try { await db.telegramUpdate.create({data:{updateId:BigInt(update.update_id),kind:Object.keys(update).find(k=>k!=='update_id')??'unknown',payload:update}}); created=true; }
    catch (e:any) { if (e?.code!=='P2002') throw e; }
    if (created) await telegramIngestQueue.add('ingest',{updateId:String(update.update_id)},{...queueOptions,jobId:`tg:${update.update_id}`});
    return {ok:true,duplicate:!created};
  });

  app.get('/telegram/status',{preHandler:[requireAuth]},async()=>safe({me:await telegramGetMe(),webhook:await telegramGetWebhookInfo(),connections:await db.telegramConnection.findMany({orderBy:{updatedAt:'desc'}})}));
  app.post('/telegram/setup-webhook',{preHandler:[requireAuth]},async()=>({ok:await telegramSetWebhook()}));

  app.get('/conversations',{preHandler:[requireAuth]},async (req:any)=>{
    const q=req.query??{}; const where:any={};
    if(q.filter==='new')where.contact={status:'NEW'};
    if(q.filter==='approval')where.messages={some:{status:'AWAITING_APPROVAL'}};
    if(q.filter==='waiting')where.contact={status:'WAITING_CLIENT'};
    if(q.filter==='hot')where.contact={priority:'HOT'};
    if(q.filter==='completed')where.contact={status:'COMPLETED'};
    const rows=await db.conversation.findMany({where,include:{contact:true,messages:{where:{deletedAt:null},orderBy:{createdAt:'desc'},take:1}},orderBy:{lastMessageAt:'desc'},take:100});
    return safe(rows);
  });
  app.get('/conversations/:id',{preHandler:[requireAuth]},async(req:any,reply)=>{
    const row=await db.conversation.findUnique({where:{id:req.params.id},include:{contact:{include:{profile:true,tasks:true}},messages:{where:{deletedAt:null},include:{attachments:true},orderBy:{createdAt:'asc'}},generations:{orderBy:{createdAt:'desc'},take:20}}});
    if(!row)return reply.code(404).send({error:'Not found'}); return safe(row);
  });
  app.patch('/conversations/:id',{preHandler:[requireAuth]},async(req:any)=>safe(await db.conversation.update({where:{id:req.params.id},data:conversationPatch(req.body) as any})));
  app.post('/conversations/:id/ai-draft',{preHandler:[requireAuth]},async(req:any,reply)=>{
    const message=await db.message.findFirst({where:{conversationId:req.params.id,direction:'IN',deletedAt:null,text:{not:null}},orderBy:{createdAt:'desc'}});
    if(!message)return reply.code(404).send({error:'No inbound text message'});
    await aiDraftQueue.add('draft',{messageId:message.id},{...queueOptions,jobId:`manual-draft:${message.id}:${Date.now()}`});
    await db.auditLog.create({data:{actor:'operator',action:'AI draft requested',entityType:'message',entityId:message.id}});
    return {ok:true};
  });

  app.post('/messages/send',{preHandler:[requireAuth]},async(req:any)=>{const b=objectBody(req.body);const conversationId=cleanText(b.conversationId,'conversationId',100,true)!;const text=cleanText(b.text,'text',4096,true)!;return safe(await sendOperatorMessage(conversationId,text));});

  app.get('/approvals',{preHandler:[requireAuth]},async()=>safe(await db.aiGeneration.findMany({where:{status:'APPROVAL_REQUIRED'},include:{conversation:{include:{contact:true}},sourceMessage:true},orderBy:{createdAt:'asc'},take:100})));
  app.post('/ai/:id/approve',{preHandler:[requireAuth]},async(req:any)=>{const g=await db.aiGeneration.update({where:{id:req.params.id},data:{status:'AUTO_QUEUED'}});await messageSendQueue.add('send',{generationId:g.id,actor:'operator'},{...queueOptions,jobId:`send:${g.id}`});return {ok:true};});
  app.post('/ai/:id/reject',{preHandler:[requireAuth]},async(req:any)=>{await db.aiGeneration.update({where:{id:req.params.id},data:{status:'REJECTED'}});await db.auditLog.create({data:{actor:'operator',action:'AI response rejected',entityType:'ai_generation',entityId:req.params.id}});return {ok:true};});
  app.post('/ai/:id/regenerate',{preHandler:[requireAuth]},async(req:any,reply)=>{const g=await db.aiGeneration.findUnique({where:{id:req.params.id}});if(!g)return reply.code(404).send({error:'Not found'});await aiDraftQueue.add('draft',{messageId:g.sourceMessageId},{...queueOptions,jobId:`redraft:${g.sourceMessageId}:${Date.now()}`});return {ok:true};});
  app.patch('/ai/:id',{preHandler:[requireAuth]},async(req:any)=>{const b=objectBody(req.body);const answer=cleanText(b.answer,'answer',4096,true)!;const row=await db.aiGeneration.update({where:{id:req.params.id},data:{answer}});await db.auditLog.create({data:{actor:'operator',action:'operator edited response',entityType:'ai_generation',entityId:req.params.id}});return safe(row);});

  app.get('/contacts',{preHandler:[requireAuth]},async(req:any)=>{const q=cleanText(req.query?.q,'q',200)??'';return safe(await db.contact.findMany({where:q?{OR:[{name:{contains:q,mode:'insensitive'}},{username:{contains:q,mode:'insensitive'}},{phone:{contains:q}},{summary:{contains:q,mode:'insensitive'}},{need:{contains:q,mode:'insensitive'}}]}:{},orderBy:{lastContactAt:'desc'},take:100}));});
  app.patch('/contacts/:id',{preHandler:[requireAuth]},async(req:any)=>{const row=await db.contact.update({where:{id:req.params.id},data:contactPatch(req.body) as any});await db.auditLog.create({data:{actor:'operator',action:'contact updated',entityType:'contact',entityId:row.id}});return safe(row);});

  app.get('/search',{preHandler:[requireAuth]},async(req:any)=>{const q=cleanText(req.query?.q,'q',200,true)!;const [contacts,messages,knowledge]=await Promise.all([
    db.contact.findMany({where:{OR:[{name:{contains:q,mode:'insensitive'}},{username:{contains:q,mode:'insensitive'}},{phone:{contains:q}},{summary:{contains:q,mode:'insensitive'}},{need:{contains:q,mode:'insensitive'}}]},take:50,orderBy:{lastContactAt:'desc'}}),
    db.message.findMany({where:{text:{contains:q,mode:'insensitive'},deletedAt:null},include:{conversation:{include:{contact:true}}},take:50,orderBy:{createdAt:'desc'}}),
    db.knowledgeItem.findMany({where:{OR:[{title:{contains:q,mode:'insensitive'}},{description:{contains:q,mode:'insensitive'}},{operatorComment:{contains:q,mode:'insensitive'}}]},take:50,orderBy:{updatedAt:'desc'}})
  ]);return safe({contacts,messages,knowledge});});

  app.get('/knowledge',{preHandler:[requireAuth]},async(req:any)=>safe(await db.knowledgeItem.findMany({where:req.query?.status?{status:String(req.query.status).toUpperCase() as any}:{},orderBy:{updatedAt:'desc'},take:500})));
  app.post('/knowledge',{preHandler:[requireAuth]},async(req:any)=>{const row=await db.knowledgeItem.create({data:knowledgeInput(req.body) as any});await db.auditLog.create({data:{actor:'operator',action:'knowledge updated',entityType:'knowledge_item',entityId:row.id,payload:{action:'create'}}});return safe(row);});
  app.patch('/knowledge/:id',{preHandler:[requireAuth]},async(req:any)=>{const row=await db.knowledgeItem.update({where:{id:req.params.id},data:knowledgeInput(req.body,true) as any});await db.auditLog.create({data:{actor:'operator',action:'knowledge updated',entityType:'knowledge_item',entityId:row.id,payload:{action:'update'}}});return safe(row);});

  app.get('/automation',{preHandler:[requireAuth]},async()=>safe(await db.automationRule.findUnique({where:{scope:'global'}})));
  app.put('/automation',{preHandler:[requireAuth]},async(req:any)=>{const data=automationInput(req.body);const row=await db.automationRule.upsert({where:{scope:'global'},update:data as any,create:{scope:'global',...data} as any});await db.auditLog.create({data:{actor:'operator',action:'rule changed',entityType:'automation_rule',entityId:row.id}});return safe(row);});

  app.get('/dashboard',{preHandler:[requireAuth]},async()=>{
    const [newCount,active,approval,waiting,hot,completed,lost,categories]=await Promise.all([
      db.contact.count({where:{status:'NEW'}}),db.contact.count({where:{status:{in:['QUALIFYING','QUALIFIED','OFFER_SENT','IN_PROGRESS','BOOKED','PAID']}}}),
      db.aiGeneration.count({where:{status:'APPROVAL_REQUIRED'}}),db.contact.count({where:{status:'WAITING_CLIENT'}}),db.contact.count({where:{priority:'HOT'}}),db.contact.count({where:{status:'COMPLETED'}}),db.contact.count({where:{status:'LOST'}}),db.contact.groupBy({by:['intent'],_count:{_all:true}})
    ]);return {new:newCount,active,approval,waiting,hot,completed,lost,categories};
  });

  app.get('/tasks',{preHandler:[requireAuth]},async()=>safe(await db.task.findMany({where:{completedAt:null},include:{contact:true},orderBy:{dueAt:'asc'},take:200})));
  app.post('/tasks',{preHandler:[requireAuth]},async(req:any)=>safe(await db.task.create({data:taskInput(req.body) as any})));
  app.patch('/tasks/:id',{preHandler:[requireAuth]},async(req:any)=>safe(await db.task.update({where:{id:req.params.id},data:taskInput(req.body,true) as any})));
  app.get('/errors',{preHandler:[requireAuth]},async()=>safe(await db.failedJob.findMany({orderBy:{createdAt:'desc'},take:200})));
  app.post('/errors/:id/retry',{preHandler:[requireAuth]},async(req:any)=>retryFailedJob(req.params.id));
}
