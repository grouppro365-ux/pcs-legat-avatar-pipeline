import {createClient} from 'jsr:@supabase/supabase-js@2';
import {receiveLine,lineEventStore,lineMessageRecord} from './line-ingress.mjs';
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
async function secret(name:string){const r=await sb.rpc('pcs_secret_get',{p_name:name});if(r.error)throw r.error;return r.data||'';}
async function ingest(row:any,eventId:string){
 const observedAt=new Date(row.timestamp).toISOString();
 const found=await sb.rpc('pcs_line_ingress_contact',{p_sender:row.sender,p_received_at:observedAt});if(found.error||!found.data?.id)throw Error('line_contact_unavailable');
 const contact=found.data,record=lineMessageRecord(row,contact,eventId);
 const saved=await sb.from('pcs_messages').upsert(record,{onConflict:'channel,external_message_id,direction',ignoreDuplicates:true});if(saved.error)throw saved.error;
 let intent=null;if(row.kind==='text'){const r=await sb.rpc('pcs_strong_intent_from_text',{p_text:row.text});if(r.error)throw r.error;intent=r.data||null;}
 // A late signed message is retained in history but cannot replace a newer summary.
 const r=await sb.from('pcs_contacts').update({preferred_channel:'line',last_contact_at:observedAt,...(intent?{intent,need:row.text}:{})}).eq('id',contact.id).or('last_contact_at.is.null,last_contact_at.lte.'+observedAt);if(r.error)throw r.error;
}
Deno.serve(request=>receiveLine(request,{secret:()=>secret('channel_line_channel_secret'),store:lineEventStore(sb),ingest}));
