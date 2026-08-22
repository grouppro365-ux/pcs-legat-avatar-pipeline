import { Worker } from 'bullmq';
import { redis, processTelegramUpdate, draftForMessage, sendGeneration, recordFailedJob, workerBackoffSettings } from '@pcs/backend';

const connection=redis;
const workers=[
  new Worker('telegram-ingest',async job=>processTelegramUpdate(String(job.data.updateId)),{connection,concurrency:20,settings:workerBackoffSettings}),
  new Worker('ai-draft',async job=>draftForMessage(String(job.data.messageId)),{connection,concurrency:5,settings:workerBackoffSettings}),
  new Worker('message-send',async job=>sendGeneration(String(job.data.generationId),String(job.data.actor??'ai')),{connection,concurrency:10,settings:workerBackoffSettings})
];
for(const w of workers){w.on('failed',(job,error)=>{void recordFailedJob(w.name,job,error)});}
setInterval(()=>{void redis.set('pcs:worker:heartbeat',String(Date.now()),'EX',60)},15000);
await redis.set('pcs:worker:heartbeat',String(Date.now()),'EX',60);
console.log('PCS worker started');
