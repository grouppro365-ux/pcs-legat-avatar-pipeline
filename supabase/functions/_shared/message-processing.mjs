// Durable processing in the existing Conversation Hub event store. Transport adapters
// supply send/record/review; no channel-specific business rules belong here.
export async function processMessage({db,channel,key,handle,send,record,review}){
  if(!channel||!key)throw Error('message_identity_missing');
  const owner=crypto.randomUUID();
  const inserted=await db.from('pcs_channel_events').insert({channel,external_event_id:key,status:'processing',payload:{owner}}).select('*').single();
  let event=inserted.data;
  if(inserted.error){
    if(inserted.error.code!=='23505')throw inserted.error;
    const found=await db.from('pcs_channel_events').select('*').eq('channel',channel).eq('external_event_id',key).maybeSingle();
    if(found.error)throw found.error;
    event=found.data;if(!event)throw Error('message_claim_missing');
    if(event.status==='processed')return {sent:false,duplicate:true};
    if(event.status==='delivery_uncertain'){
      await review(event.id,event.payload.outgoing);
      return {sent:false,delivery_review_required:true};
    }
    // Never steal active or uncertain external work. Recovery of a crashed worker
    // requires inspecting the persisted stage; time alone cannot prove non-delivery.
    if(!['failed','sent'].includes(event.status))throw Error('message_processing_in_progress');
    const claimed=await db.from('pcs_channel_events').update({status:event.status==='sent'?'recording':'processing',payload:{...event.payload,owner},error:null})
      .eq('id',event.id).eq('status',event.status).eq('payload->>owner',event.payload.owner).select('*').maybeSingle();
    if(claimed.error)throw claimed.error;
    if(!claimed.data)throw Error('message_claim_busy');
    event=claimed.data;
  }
  if(!event)throw Error('message_claim_missing');
  const move=async(status,payload=event.payload,error=null)=>{
    const changed=await db.from('pcs_channel_events').update({status,payload,error,processed_at:status==='processed'?new Date().toISOString():null})
      .eq('id',event.id).eq('status',event.status).eq('payload->>owner',owner).select('*').maybeSingle();
    if(changed.error)throw changed.error;
    if(!changed.data)throw Error('message_claim_lost');
    event=changed.data;
  };
  try{
    if(event.status==='recording'){
      await record(event.payload.outgoing,event.payload.receipt);
      await move('processed');return {sent:true,recovered_receipt:true};
    }
    const result=await handle({eventId:event.id,send:async(outgoing)=>{
      if(event.status!=='processing')throw Error('message_already_sent');
      await move('sending',{...event.payload,outgoing});
      const receipt=await send(outgoing);
      // Receipt is durable before writing chat history. A retry can repair history
      // using this receipt without a second provider send.
      await move('sent',{...event.payload,receipt});
      await record(outgoing,receipt);
      return receipt;
    }});
    await move('processed');return result;
  }catch(error){
    if(event.status==='processing')await move('failed',event.payload,'processing_failed');
    else if(event.status==='recording')await move('sent',event.payload,'history_recording_failed');
    else if(event.status==='sending'){
      await move('delivery_uncertain',event.payload,'delivery_outcome_unknown');
      await review(event.id,event.payload.outgoing);
    }
    // `sent` is deliberately retained when history/finish persistence fails.
    throw error;
  }
}
