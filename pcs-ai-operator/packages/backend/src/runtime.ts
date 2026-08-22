import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { loadConfig } from './config.js';
import { retryDelayMs } from '@pcs/core';

export const config = loadConfig();
export const db = new PrismaClient();
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const telegramIngestQueue = new Queue('telegram-ingest', { connection: redis });
export const aiDraftQueue = new Queue('ai-draft', { connection: redis });
export const messageSendQueue = new Queue('message-send', { connection: redis });

export const queueOptions = {
  attempts: 5,
  backoff: { type: 'pcs_schedule' as const, delay: 0 },
  removeOnComplete: 1000,
  removeOnFail: 1000
};

export const workerBackoffSettings = {
  backoffStrategy: (attemptsMade: number, type?: string) => type === 'pcs_schedule' ? retryDelayMs(attemptsMade) : -1
};
