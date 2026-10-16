// Stable per-source identity makes concurrent/replayed webhook generation converge.
export async function generationIdentity(channel, messageId) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pcs-meta-reply:'+channel+':'+messageId)));
  bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function recoverableEvent(event, now=Date.now()) {
  if(!event)return false;
  if(event.status==='failed')return true;
  const at=Date.parse(event.payload?.started_at||event.received_at||event.created_at||'');
  return event.status==='processing'&&Number.isFinite(at)&&now-at>120000;
}
export function generationDisposition(record,{localDraft=false,autoAllowed=false,now=Date.now()}={}) {
  if(record.status==='sent')return 'sent';
  if(localDraft&&['pending_send','sending'].includes(record.status))return 'local';
  if(!localDraft&&record.policy_decision==='auto'&&record.requires_human===false&&['sending','failed'].includes(record.status)&&autoAllowed){
    const created=Date.parse(record.created_at||'');
    if(Number.isFinite(created)&&now-created<=5*60000)return 'send';
  }
  return 'approval';
}
