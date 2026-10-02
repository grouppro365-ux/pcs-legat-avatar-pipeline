// Only this narrow bridge is shared with NAVI. It cannot send messages or approve payments.
const BASE='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api';
const enc=new TextEncoder();
function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function mac(s:string,key:string){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function unpack(t:string,key:string){try{const [s,h]=t.split('.');if(!s||!h||!equal(await mac(s,key),h))return null;const x=JSON.parse(atob(s));if(Date.now()-x.at>90*86400000||x.at>Date.now()+60000)return null;return x}catch{return null}}
async function rpc(sb:any,name:string,p:any){const {data,error}=await sb.rpc(name,p);if(error)throw error;return data}
export async function acquisition(r:Request,a:string[],sb:any,secret:(n:string)=>Promise<string>,reply:(r:Request,d:any,s?:number)=>Response):Promise<Response|null>{
 if(a[0]!=='navi'&&a[0]!=='r')return null;
 const key=await secret('navi_pcs_bridge_key');if(!key)return reply(r,{error:'Подключение к PCS пока недоступно.'},503);
 try{
  if(a[0]==='r'){
   if(r.method!=='GET'||! /^[A-Za-z0-9_-]{16,48}$/.test(a[1]||''))return reply(r,{error:'Ссылка недоступна.'},404);
   const {data:l,error}=await sb.from('pcs_referral_links').select('*,pcs_partner_agreements(status)').eq('code',a[1]).maybeSingle();if(error)throw error;
   if(!l||l.status!=='ACTIVE'||l.pcs_partner_agreements?.status!=='ACTIVE')return new Response(null,{status:302,headers:{location:'https://vipthaiconcierge.com/','cache-control':'no-store'}});
   const cookie=(r.headers.get('cookie')||'').match(/(?:^|;\s*)pcs_ref=([^;]+)/)?.[1];let first=cookie?await unpack(cookie,key):null;
   const session=first?.session||crypto.randomUUID();const touch=crypto.randomUUID();const {error:te}=await sb.from('pcs_attribution_touches').insert({id:touch,link_id:l.id,session_id:session,event_key:crypto.randomUUID()});if(te)throw te;
   if(!first)first={session,link:l.id,touch,at:Date.now()};
   const s=btoa(JSON.stringify(first));const token=s+'.'+await mac(s,key);const landing=new URL(l.landing_url);for(const [k,v] of Object.entries(l.utm||{}))landing.searchParams.set(k,String(v));landing.searchParams.set('pcs_ref',token);
   return new Response(null,{status:302,headers:{location:landing.toString(),'set-cookie':`pcs_ref=${token}; Max-Age=7776000; Path=/functions/v1/pcs-ui-api; Secure; HttpOnly; SameSite=Lax`,'cache-control':'no-store','referrer-policy':'strict-origin-when-cross-origin'}});
  }
  if(!equal(r.headers.get('x-navi-bridge-key')||'',key))return reply(r,{error:'Доступ закрыт.'},401);
  const b=r.method==='POST'?await r.json():{};const actor=String(b.actor||'');let data:any;
  if(a[1]==='report'&&r.method==='POST'){await rpc(sb,'pcs_navi_reconcile',{});await rpc(sb,'pcs_navi_daily_snapshots',{});data=await rpc(sb,'pcs_navi_report',{p_since:b.since||null});const q=await sb.from('pcs_finance_entries').select('id,entry_type,amount,currency,paid_at,counterparty,metadata').eq('status','paid').in('entry_type',['expense','partner_payout']);if(q.error)throw q.error;const {data:contacts,error:ce}=await sb.from('pcs_contacts').select('id,name,username').order('created_at',{ascending:false}).limit(500);if(ce)throw ce;data.contacts=(contacts||[]).map((c:any,i:number)=>({id:c.id,name:c.name||c.username||'Клиент '+(i+1)}));data.available_expenses=(q.data||[]).filter((f:any)=>f.entry_type==='expense');data.available_payouts=(q.data||[]).filter((f:any)=>f.entry_type==='partner_payout');for(const p of data.partners)for(const m of p.metrics){m.paid_commission=data.available_payouts.filter((f:any)=>f.currency===m.currency&&f.metadata?.navi_agreement_id===p.id).reduce((v:number,f:any)=>v+Number(f.amount),0);m.commission_due=Number(m.commission)-m.paid_commission;}}
  else if(a[1]==='activate'&&r.method==='POST'){
   if(b.confirmed!==true||!actor)throw Error('agreement_confirmation_required');
   data=await rpc(sb,'pcs_navi_activate',{p_identity:b.identity,p_name:b.name,p_contact:b.contact||'',p_model:b.model||'REFERRAL',p_rate:b.rate??3,p_terms:b.terms,p_actor:actor,p_context:b.context||{}});
   data.link.url=BASE+'/r/'+data.link.code;
  }
  else if(a[1]==='campaign'&&r.method==='POST'){if(b.confirmed!==true)throw Error('confirmation_required');data=await rpc(sb,'pcs_navi_campaign',{p_agreement:b.agreement_id,p_campaign:b.campaign,p_landing:b.landing||'https://vipthaiconcierge.com/',p_request_key:b.request_key,p_actor:actor});data.url=BASE+'/r/'+data.code;}
  else if(a[1]==='placement'&&r.method==='POST'){if(b.confirmed!==true)throw Error('confirmation_required');data=await rpc(sb,'pcs_navi_placement',{p_agreement:b.agreement_id,p_source:b.source_id||null,p_title:b.title,p_campaign:b.campaign,p_model:b.model,p_currency:b.currency||'THB',p_requested:b.requested_price??null,p_agreed:b.agreed_price??null,p_actor:actor,p_key:b.request_key});data.link.url=BASE+'/r/'+data.link.code;}
  else if(a[1]==='agreement'&&r.method==='POST'){if(b.confirmed!==true)throw Error('confirmation_required');data=await rpc(sb,'pcs_navi_agreement_update',{p_id:b.agreement_id,p_status:b.status,p_rate:b.rate,p_terms:b.terms,p_actor:actor});}
  else if(a[1]==='placement_update'&&r.method==='POST'){if(b.confirmed!==true)throw Error('confirmation_required');data=await rpc(sb,'pcs_navi_placement_update',{p_id:b.placement_id,p_status:b.status,p_finance:b.finance_entry_id||null,p_post_url:b.post_url||null,p_actor:actor});}
  else if(a[1]==='payout'&&r.method==='POST'){if(b.confirmed!==true)throw Error('confirmation_required');data=await rpc(sb,'pcs_navi_link_payout',{p_agreement:b.agreement_id,p_finance:b.finance_entry_id,p_actor:actor});}
  else if(a[1]==='attribute'&&r.method==='POST'){
   const x=b.token?await unpack(b.token,key):null;
   if(!x&&!(b.manual===true&&b.confirmed===true&&actor&&b.evidence))throw Error('verified_referral_required');
   data=await rpc(sb,'pcs_navi_attribute',{p_contact:b.contact_id,p_touch:x?.touch||null,p_link:x?.link||b.link_id,p_actor:actor,p_evidence:b.evidence||'Подтверждённый переход по партнёрской ссылке',p_allow_existing:!x&&b.manual===true});await rpc(sb,'pcs_navi_reconcile',{});
  }else return reply(r,{error:'Действие недоступно.'},404);
  return reply(r,{ok:true,data});
 }catch(e){console.error('navi_acquisition',e);const msg=String((e as any)?.message||e);const known:Record<string,string>={existing_terms_require_explicit_amendment:'У партнёра уже есть согласованные условия. Измените их отдельно.',active_agreement_required:'Сначала подтвердите подключение партнёра.',agreement_confirmation_required:'Подтвердите договорённость и укажите её условия.',refund_exceeds_paid_original:'Возврат превышает оплаченную сумму.',existing_client_before_touch:'Этот клиент уже был в PCS до перехода по ссылке.'};return reply(r,{ok:false,error:known[msg]||'Не удалось выполнить действие. Проверьте условия и повторите.'},409)}
}
