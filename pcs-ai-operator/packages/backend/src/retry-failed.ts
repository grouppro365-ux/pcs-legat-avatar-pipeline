import { aiDraftQueue, db, messageSendQueue, queueOptions, telegramIngestQueue } from './runtime.js';

export async function retryFailedJob(id: string) {
  const failed = await db.failedJob.findUnique({ where: { id } });
  if (!failed) throw new Error('Failed job not found');
  const payload = (failed.payload ?? {}) as Record<string, unknown>;
  const suffix = `${Date.now()}:${failed.id}`;
  if (failed.queue === 'telegram-ingest') await telegramIngestQueue.add('ingest', payload, { ...queueOptions, jobId: `retry:ingest:${suffix}` });
  else if (failed.queue === 'ai-draft') await aiDraftQueue.add('draft', payload, { ...queueOptions, jobId: `retry:draft:${suffix}` });
  else if (failed.queue === 'message-send') await messageSendQueue.add('send', payload, { ...queueOptions, jobId: `retry:send:${suffix}` });
  else throw new Error(`Unsupported failed queue ${failed.queue}`);
  await db.failedJob.update({ where: { id }, data: { retriedAt: new Date() } });
  await db.auditLog.create({ data: { actor: 'operator', action: 'failed job retried', entityType: 'failed_job', entityId: id } });
  return { ok: true };
}
