import { generationIdentity, recoverableEvent } from '../pcs-meta-webhook-v1/inbound-recovery.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const RUNTIME=Deno.env.get('SUPABASE_URL')!+'/functions/v1/pcs-business-runtime-v8';
const GATEWAY=Deno.env.get('SUPABASE_URL')!+'/functions/v1/pcs-tg-gateway/booking-reconcile';
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json;charset=utf-8'}});
async function sec(n:string){const {data,error}=await db.rpc('pcs_secret_get',{p_name:n});if(error)throw error;return data||''}
function next(attempts:number){const delay=attempts<=1?30:attempts===2?120:attempts===3?600:null;return delay?new Date(Date.now()+delay*1000).toISOString():null}
async function retryUpdate(job:any){
  const updateId=Number(job.payload?.update_id);if(!Number.isInteger(updateId))throw Error('missing_update_id');
  const {data:u,error}=await db.from('pcs_updates').select('payload,status').eq('update_id',updateId).single();
  if(error||!u?.payload)throw Error('update_not_found');if(u.status==='processed')return;
  const secret=await sec('telegram_webhook_secret');if(!secret)throw Error('webhook_secret_missing');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),55000);
  try{
    const response=await fetch(RUNTIME,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(u.payload),signal:ctrl.signal});
    const body=await response.text();if(!response.ok)throw Error(`runtime_http_${response.status}:${body.slice(0,300)}`);
    const parsed=JSON.parse(body);if(parsed?.ok!==true)throw Error('runtime_not_ok');
    const updated=await db.from('pcs_updates').update({status:'processed',processed_at:new Date().toISOString(),error:null,last_attempt_at:new Date().toISOString()}).eq('update_id',updateId);
    if(updated.error)throw updated.error;
  }finally{clearTimeout(timer)}
}
async function retryMeta(job:any){
  const channel=String(job.payload?.channel||''),id=String(job.payload?.event_row_id||'');
  if(!['instagram','whatsapp','facebook'].includes(channel)||!/^[0-9a-f-]{36}$/i.test(id))throw Error('invalid_meta_recovery');
  const secret=await sec('internal_retry_secret');if(!secret)throw Error('recovery_secret_missing');
  const response=await fetch(Deno.env.get('SUPABASE_URL')!+'/functions/v1/pcs-meta-webhook-v1?op=recover&channel='+channel,
    {method:'POST',headers:{'content-type':'application/json','x-pcs-internal-secret':secret},body:JSON.stringify({event_row_id:id}),signal:AbortSignal.timeout(55000)});
  const body=await response.json().catch(()=>({}));if(!response.ok||body?.ok!==true)throw Error('meta_recovery_failed');
}
async function recoverInterruptedJobs(){
  const cutoff=new Date(Date.now()-120000).toISOString();
  const stuck=await db.from('pcs_failed_jobs').select('id,operation,last_attempt_at').eq('status','retrying').lt('last_attempt_at',cutoff).limit(20);
  if(stuck.error)throw stuck.error;
  for(const job of stuck.data||[]){
    const safe=['telegram_update','meta_inbound'].includes(job.operation);
    const changed=await db.from('pcs_failed_jobs').update({status:safe?'failed':'review_required',
      next_retry_at:safe?new Date().toISOString():null,error:safe?'interrupted_retry_recovered':'delivery_outcome_requires_review'})
      .eq('id',job.id).eq('status','retrying').eq('last_attempt_at',job.last_attempt_at);
    if(changed.error)throw changed.error;
  }
  // Recover a runtime killed before its catch block could enqueue its job.
  const cursorKey='meta-recovery-scan-cursor';
  const initialized=await db.from('pcs_channel_events').upsert({channel:'internal',external_event_id:cursorKey,
    status:'processed',payload:{after_id:null,revision:crypto.randomUUID()}},{onConflict:'channel,external_event_id',ignoreDuplicates:true});
  if(initialized.error)throw initialized.error;
  const cursor=await db.from('pcs_channel_events').select('id,payload').eq('channel','internal').eq('external_event_id',cursorKey).single();
  if(cursor.error)throw cursor.error;
  const afterId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.data.payload?.after_id||'')?cursor.data.payload.after_id:null;
  let scan=db.from('pcs_channel_events').select('id,channel,status,payload,received_at')
    .in('status',['processing','failed']).in('channel',['instagram','whatsapp','facebook'])
    .not('payload->rows','is',null).lt('received_at',cutoff).order('id').limit(40);
  if(afterId)scan=scan.gt('id',afterId);
  const events=await scan;
  if(events.error)throw events.error;
  for(const event of events.data||[]){
    if(!Array.isArray(event.payload?.rows)||!recoverableEvent(event))continue;
    const queued=await db.from('pcs_failed_jobs').upsert({id:await generationIdentity('meta-recovery',event.id),operation:'meta_inbound',
      payload:{channel:event.channel,event_row_id:event.id},error:'interrupted_inbound_recovered',next_retry_at:new Date().toISOString()},
      {onConflict:'id',ignoreDuplicates:true});
    if(queued.error)throw queued.error;
  }
  // Advance only after every selected row is durable. An empty page wraps; the
  // cursor is independent of cron cadence, row-count changes and wall time.
  let advance=db.from('pcs_channel_events').update({payload:{after_id:events.data?.at(-1)?.id||null,revision:crypto.randomUUID()}})
    .eq('id',cursor.data.id);
  advance=cursor.data.payload?.revision?advance.eq('payload->>revision',cursor.data.payload.revision):advance.is('payload->>revision',null);
  const moved=await advance;if(moved.error)throw moved.error;
}
async function runJob(job:any){
  const attempts=Number(job.attempts||0)+1;
  const claim=await db.from('pcs_failed_jobs').update({status:'retrying',attempts,last_attempt_at:new Date().toISOString()}).eq('id',job.id).eq('status','failed').eq('attempts',Number(job.attempts||0)).select('id').maybeSingle();
  if(claim.error)throw claim.error;if(!claim.data)return false;
  try{
    if(job.operation==='telegram_update')await retryUpdate(job);
    else if(job.operation==='meta_inbound')await retryMeta(job);
    else if(/(?:_send)$/.test(job.operation))throw Error('delivery_outcome_requires_review');
    else throw Error(`unsupported_operation:${job.operation}`);
    const done=await db.from('pcs_failed_jobs').update({status:'resolved',resolved_at:new Date().toISOString(),retried_at:new Date().toISOString(),next_retry_at:null,error:job.error}).eq('id',job.id).eq('status','retrying').eq('attempts',attempts);
    if(done.error)throw done.error;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(message==='delivery_outcome_requires_review'){
      const held=await db.from('pcs_failed_jobs').update({status:'review_required',attempts,last_attempt_at:new Date().toISOString(),retried_at:new Date().toISOString(),next_retry_at:null,error:message}).eq('id',job.id).eq('status','retrying').eq('attempts',attempts);if(held.error)throw held.error;
    }else{
      const when=next(attempts),failed=await db.from('pcs_failed_jobs').update({status:when?'failed':'dlq',attempts,last_attempt_at:new Date().toISOString(),retried_at:new Date().toISOString(),next_retry_at:when,error:message}).eq('id',job.id).eq('status','retrying').eq('attempts',attempts);if(failed.error)throw failed.error;
    }
  }
  return true;
}
async function reconcileBookings(secret:string){
  const cursorKey='booking-reconcile-scan-cursor';
  const initialized=await db.from('pcs_channel_events').upsert({channel:'internal',external_event_id:cursorKey,
    status:'processed',payload:{after_id:null,revision:crypto.randomUUID()}},{onConflict:'channel,external_event_id',ignoreDuplicates:true});
  if(initialized.error)throw initialized.error;
  const cursor=await db.from('pcs_channel_events').select('id,payload').eq('channel','internal').eq('external_event_id',cursorKey).single();
  if(cursor.error)throw cursor.error;
  const afterId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.data.payload?.after_id||'')?cursor.data.payload.after_id:null;
  let scan=db.from('pcs_booking_requests').select('id').eq('status','ready_for_booking').order('id').limit(5);
  if(afterId)scan=scan.gt('id',afterId);
  const [waiting,notifications]=await Promise.all([
    scan,
    db.from('pcs_booking_confirmation_outbox').select('request_id').neq('status','sent').order('updated_at').limit(5)
  ]);
  if(waiting.error)throw waiting.error;
  if(notifications.error)throw notifications.error;
  const ids=[...new Set([...(waiting.data||[]).map((r:any)=>r.id),...(notifications.data||[]).map((r:any)=>r.request_id)])];
  const results=await Promise.all(ids.map(async id=>{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000);
    try{
      const response=await fetch(GATEWAY,{method:'POST',headers:{'content-type':'application/json','x-pcs-internal-secret':secret},body:JSON.stringify({request_id:id}),signal:ctrl.signal});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||body?.ok!==true)throw Error(String(body?.error||`gateway_${response.status}`));
      return{status:body.result?.status||'unknown',ok:true};
    }catch(error){console.error('booking_reconcile_failed',id,error instanceof Error?error.message:String(error));return{status:'failed',ok:false}}
    finally{clearTimeout(timer)}
  }));
  let advance=db.from('pcs_channel_events').update({payload:{after_id:waiting.data?.at(-1)?.id||null,revision:crypto.randomUUID()}})
    .eq('id',cursor.data.id);
  advance=cursor.data.payload?.revision?advance.eq('payload->>revision',cursor.data.payload.revision):advance.is('payload->>revision',null);
  const moved=await advance;if(moved.error)throw moved.error;
  return{checked:ids.length,confirmed:results.filter(x=>x.status==='booked').length,failed:results.filter(x=>!x.ok).length};
}
Deno.serve(async req=>{
  if(req.method!=='POST')return J({error:'method_not_allowed'},405);
  const expected=await sec('internal_retry_secret').catch(()=>'');if(!expected||req.headers.get('x-pcs-retry-secret')!==expected)return J({error:'unauthorized'},401);
  await recoverInterruptedJobs();
  const {data:jobs,error}=await db.from('pcs_failed_jobs').select('*').eq('status','failed').lte('next_retry_at',new Date().toISOString()).order('created_at').limit(20);if(error)throw error;
  let processed=0;for(const job of jobs||[])if(await runJob(job))processed++;
  const bookings=await reconcileBookings(expected);
  return J({ok:true,processed,bookings});
});

