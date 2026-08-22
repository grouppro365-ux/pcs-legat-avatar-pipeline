import { db } from './runtime.js';

export async function recordFailedJob(queue: string, job: any, error: Error) {
  if ((job?.attemptsMade ?? 0) + 1 < (job?.opts?.attempts ?? 1)) return;
  await db.failedJob.create({data:{queue,jobId:String(job?.id ?? ''),operation:String(job?.name ?? 'unknown'),payload:job?.data ?? {},error:error.message,attempts:(job?.attemptsMade ?? 0)+1}});
}
