import {CrmError} from './crm-policy.mjs';
import {sourceUsername,parsePublicPage,prospectVersion,classifyPublicMessages} from './prospect-policy.mjs';
export async function prospectAI(base,key,transport=fetch){
 const headers={apikey:key,authorization:'Bearer '+key,'content-type':'application/json'};
 const responses=await Promise.all([transport(base+'/rest/v1/pcs_settings?id=eq.main&select=openrouter_model',{headers,signal:AbortSignal.timeout(15000)}),transport(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers,body:JSON.stringify({p_name:'openrouter_key'}),signal:AbortSignal.timeout(15000)})]);
 if(responses.some(r=>!r.ok))throw Error('ai_not_configured');
 const settings=(await responses[0].json())[0],secret=await responses[1].json();
 if(typeof secret!=='string'||!secret||!settings?.openrouter_model)throw Error('ai_not_configured');
 return{model:settings.openrouter_model,classify:messages=>classifyPublicMessages(messages,settings,secret,transport)};
}
export const saveReviewClassifications=`with saved as (
 update pcs_prospect_requests r set decision=x.decision,direction=x.direction,reason=x.reason,evidence=x.evidence,facts=x.facts,outreach_status=x.outreach_status,qualification_model=$2,qualification_version=$3,updated_at=now()
 from jsonb_to_recordset($1::jsonb) x(id text,message_text text,expected_updated_at text,decision text,direction text,reason text,evidence text,facts jsonb,outreach_status text)
 where r.id=x.id and r.message_text=x.message_text and (r.decision='review' or (r.decision='qualified' and r.qualification_version is distinct from $3)) and r.updated_at=x.expected_updated_at::timestamptz
 returning r.id,r.decision),
 audit as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at)
 select $4,'pcs-prospect-worker','prospect_review_classified','prospect_run',$4,jsonb_build_object('classified',count(*),'model',$2),now() from saved having count(*)>0 returning id)
 select id,decision from saved`;
export async function classifyReviewProspects(sql,loadAI,{transport=fetch}={}){
 const config=(await sql.query("select value from system_settings where id='pcs_telegram_prospecting'"))[0]?.value;
 if(config?.enabled!==true)throw new CrmError('Поиск запросов приостановлен',409);
 const records=await sql.query("select r.id,r.telegram_message_id::text,r.message_url,r.published_at,r.message_text,r.updated_at::text updated_at,s.username from pcs_prospect_requests r join pcs_prospect_sources s on s.id=r.source_id where (r.decision='review' or (r.decision='qualified' and r.qualification_version is distinct from $1)) and r.published_at>=now()-interval '7 days' order by r.published_at desc,r.id limit 20",[prospectVersion]);
 const counts={classified:0,qualified:0,review:0,rejected:0};
 if(!records.length)return{ok:true,...counts,outreach_sent:0,outreach_blocker:'telegram_user_session_not_connected'};
 // Re-read the public page to retain forwarded-message provenance which was not stored by the review-only pass.
 const messages=[];
 for(const username of new Set(records.map(r=>r.username))){
  const group=records.filter(r=>r.username===username),before=Math.max(...group.map(r=>Number(r.telegram_message_id)))+1;
  const response=await transport('https://t.me/s/'+sourceUsername(username)+'?before='+before,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('public_history_unavailable');
  const page=parsePublicPage(await response.text(),username);
  if(!page.readable)throw Error('public_history_unavailable');
  for(const r of group){const message=page.messages.find(m=>m.id===r.telegram_message_id&&m.text===r.message_text);if(message)messages.push({...message,id:r.id});}
 }
 if(!messages.length)return{ok:true,...counts,outreach_sent:0,outreach_blocker:'telegram_user_session_not_connected'};
 const ai=await loadAI();
 const classified=await ai.classify(messages);
 const rows=classified.map(x=>({id:x.id,message_text:x.text,expected_updated_at:records.find(r=>r.id===x.id).updated_at,decision:x.decision,direction:x.direction,reason:x.reason,evidence:x.evidence,facts:x.facts,outreach_status:x.outreach_status}));
 const saved=await sql.query(saveReviewClassifications,[JSON.stringify(rows),ai.model,prospectVersion,crypto.randomUUID()]);
 counts.classified=saved.length;for(const x of saved)counts[x.decision]++;
 return{ok:true,...counts,outreach_sent:0,outreach_blocker:'telegram_user_session_not_connected'};
}
export async function addProspectSource(sql,input){
 if(!input||Object.keys(input).some(k=>!['username','title','city','language','topic','discovery_url','rules'].includes(k)))throw new CrmError('Некорректный источник',400);
 const name=sourceUsername(input.username),data={};
 for(const k of ['title','city','language','topic','discovery_url','rules']){if(input[k]!=null&&(typeof input[k]!=='string'||input[k].length>(k==='rules'?2000:400)))throw new CrmError('Некорректное описание источника',400);data[k]=input[k]||null;}
 const rows=await sql.query(`with source as (insert into pcs_prospect_sources(id,username,title,city,language,topic,discovery_url,rules)
 values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(username) do update set topic=coalesce(excluded.topic,pcs_prospect_sources.topic),updated_at=now() returning id),
 audit as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at)
 select $9,'admin','prospect_source_configured','prospect_source',id,jsonb_build_object('username',$2),now() from source returning id)
 select id,true added from source union all select id,false added from pcs_prospect_sources where username=$2 and not exists(select 1 from source)`,[crypto.randomUUID(),name,data.title,data.city,data.language,data.topic,data.discovery_url,data.rules,crypto.randomUUID()]);
 return{ok:true,source:rows[0]||{added:false}};
}
export async function readProspecting(sql,view='requests',page='0',decision='qualified',sourceKind='all'){
 if(!['all','competitor'].includes(sourceKind)||!['sources','requests','runs'].includes(view)||!/^\d{1,5}$/.test(page)||Number(page)>5000||!['qualified','review','rejected','all'].includes(decision))throw new CrmError('Некорректный фильтр поиска запросов',400);
 const offset=Number(page)*50;let rows;
 if(view==='sources')rows=await sql.query(`select id,username,title,city,language,topic,rules,enabled,access_status,last_checked_at,last_read_at,next_scan_at,cursor_id::text,pending_before::text,last_error,messages_read::text from pcs_prospect_sources where ($2='all' or topic='competitor') order by created_at,id limit 51 offset $1`,[offset,sourceKind]);
 if(view==='runs')rows=await sql.query('select id,status,started_at,finished_at,sources_checked,messages_read,qualified,review,rejected,errors,error from pcs_prospect_runs order by started_at desc,id desc limit 51 offset $1',[offset]);
 if(view==='requests')rows=await sql.query(`select r.id,r.telegram_message_id::text,r.message_url,r.published_at,r.message_text,r.decision,r.direction,r.reason,r.evidence,r.facts,r.author_verified,r.contact_id,r.outreach_status,r.qualification_model,r.updated_at,s.username source_username,s.title source_title,s.topic source_topic from pcs_prospect_requests r join pcs_prospect_sources s on s.id=r.source_id where ($1='all' or r.decision=$1) and ($3='all' or s.topic='competitor') order by r.published_at desc nulls last,r.id desc limit 51 offset $2`,[decision,offset,sourceKind]);
 const summary=(await sql.query(`select (select count(*)::int from pcs_prospect_sources) sources,(select count(*)::int from pcs_prospect_sources where last_read_at is not null) sources_read,(select count(*)::int from pcs_prospect_requests where decision='qualified') qualified,(select count(*)::int from pcs_prospect_requests where decision='review') review,(select count(*)::int from pcs_prospect_requests where decision='rejected') rejected`))[0];
 const config=(await sql.query("select value,version from system_settings where id='pcs_telegram_prospecting'"))[0];
 return{view,page:Number(page),decision,rows:rows.slice(0,50),truncated:rows.length>50,summary,enabled:config?.value?.enabled===true,version:config?.version,capabilities:{public_pages:true,telegram_user_session:false,first_private_message:false,followup_blocked:'Нет подтверждённого первого сообщения и проверенного адресата'}};
}
export async function setProspectingEnabled(sql,b){
 if(!b||Object.keys(b).some(k=>!['enabled','expected_version'].includes(k))||typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.expected_version)||b.expected_version<1)throw new CrmError('Обновите настройки поиска',400);
 const rows=await sql.query(`with saved as (update system_settings set value=jsonb_set(value,'{enabled}',to_jsonb($1::boolean)),version=version+1,updated_at=now() where id='pcs_telegram_prospecting' and version=$2 returning version,value),audit as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at) select $3,'admin','prospecting_enabled_changed','system_setting','pcs_telegram_prospecting',jsonb_build_object('enabled',$1::boolean),now() from saved returning id) select version,value->'enabled' enabled from saved`,[b.enabled,b.expected_version,crypto.randomUUID()]);
 if(!rows.length)throw new CrmError('Настройки уже изменились. Обновите страницу.',409);
 return{ok:true,...rows[0]};
}
export const claimProspectSources=`with picked as (select id from pcs_prospect_sources where enabled and next_scan_at<=now() and (lease_until is null or lease_until<now()) order by next_scan_at,id for update skip locked limit $2),claimed as (update pcs_prospect_sources s set lease_id=$1,lease_until=now()+interval '5 minutes',updated_at=now() from picked p where s.id=p.id returning s.*) select * from claimed`;
export const saveProspectPage=`with owner as (select id from pcs_prospect_sources where id=$1 and lease_id=$2 for update),saved as (
 insert into pcs_prospect_requests(id,source_id,telegram_message_id,message_url,published_at,message_text,decision,direction,reason,evidence,facts,qualification_model,qualification_version,outreach_status)
 select x.id,$1,x.message_id::bigint,x.message_url,x.published_at::timestamptz,x.message_text,x.decision,x.direction,x.reason,x.evidence,x.facts,$4,$5,x.outreach_status
 from jsonb_to_recordset($3::jsonb) x(id text,message_id text,message_url text,published_at text,message_text text,decision text,direction text,reason text,evidence text,facts jsonb,outreach_status text)
 where exists(select 1 from owner)
 on conflict(source_id,telegram_message_id) do update set message_text=excluded.message_text,decision=excluded.decision,direction=excluded.direction,reason=excluded.reason,evidence=excluded.evidence,facts=excluded.facts,outreach_status=excluded.outreach_status,qualification_model=excluded.qualification_model,qualification_version=excluded.qualification_version,updated_at=now()
 where pcs_prospect_requests.message_text is distinct from excluded.message_text returning id),
 source as (update pcs_prospect_sources set title=$6,access_status='public_readable',last_checked_at=now(),last_read_at=now(),next_scan_at=now()+interval '1 hour',cursor_id=$7::bigint,pending_before=$8::bigint,pending_top=$9::bigint,messages_read=messages_read+$10,lease_id=null,lease_until=null,last_error=null,updated_at=now() where id in(select id from owner) returning id),
 audit as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at) select $11,'pcs-prospect-worker','prospect_source_scanned','prospect_source',id,jsonb_build_object('run_id',$2,'messages_read',$10,'classified',jsonb_array_length($3::jsonb)),now() from source returning id)
 select (select count(*)::int from saved) saved,(select count(*)::int from source) source_saved`;
export async function scanProspects(sql,loadAI,{transport=fetch,limit=4,now=()=>Date.now()}={}){
 if(!Number.isInteger(limit)||limit<1||limit>4)throw new CrmError('Некорректный размер пакета',400);
 const config=(await sql.query("select value from system_settings where id='pcs_telegram_prospecting'"))[0]?.value;
 if(config?.enabled!==true)throw new CrmError('Поиск запросов приостановлен',409);
 const run=crypto.randomUUID(),counts={sources_checked:0,messages_read:0,qualified:0,review:0,rejected:0,errors:0};
 await sql.query("insert into pcs_prospect_runs(id,status) values($1,'running')",[run]);
 let sources;
 try{sources=await sql.query(claimProspectSources,[run,limit]);}catch{await sql.query("update pcs_prospect_runs set status='failed',error='source_claim_failed',finished_at=now() where id=$1",[run]);throw new CrmError('Не удалось получить источники',503)}
 let ai=null;
 for(const s of sources){let readCount=0,readable=false;
  try{
   const username=sourceUsername(s.username);const url='https://t.me/s/'+username+(s.pending_before?'?before='+s.pending_before:'');
   const response=await transport(url,{redirect:'manual',signal:AbortSignal.timeout(12000)});
   if(response.status===429)throw Error('telegram_rate_limited');
   if(!response.ok)throw Error(response.status>=300&&response.status<400?'public_history_unavailable':'public_http_error');
   const text=await response.text(),page=parsePublicPage(text,username);readable=page.readable;
   if(!readable)throw Error('public_history_unavailable');
   const instant=now(),fresh=page.messages.filter(m=>Number(m.id)>Number(s.cursor_id)&&(!m.published_at||Date.parse(m.published_at)>=instant-7*86400000));
   readCount=page.messages.length;
   const ids=fresh.filter(m=>m.text).map(m=>m.id),prior=ids.length?await sql.query('select telegram_message_id::text,message_text from pcs_prospect_requests where source_id=$1 and telegram_message_id::text=any($2::text[])',[s.id,ids]):[];
   const unprocessed=fresh.filter(m=>m.text&&!prior.some(p=>p.telegram_message_id===m.id&&p.message_text===m.text));
   let classified=[];
   if(unprocessed.length){ai=ai||await loadAI();classified=await ai.classify(unprocessed);}
   const complete=page.messages.length<20||page.messages.some(m=>Number(m.id)<=Number(s.cursor_id)||(m.published_at&&Date.parse(m.published_at)<instant-7*86400000));
   const top=s.pending_top||Math.max(...page.messages.map(m=>Number(m.id))),oldest=Math.min(...page.messages.map(m=>Number(m.id)));
   const rows=classified.map(x=>({id:crypto.randomUUID(),message_id:x.id,message_url:x.message_url,published_at:x.published_at,message_text:x.text,decision:x.decision,direction:x.direction,reason:x.reason,evidence:x.evidence,facts:x.facts,outreach_status:x.outreach_status}));
   const saved=await sql.query(saveProspectPage,[s.id,run,JSON.stringify(rows),ai?.model||null,prospectVersion,page.title,complete?top:s.cursor_id,complete?null:oldest,complete?null:top,readCount,crypto.randomUUID()]);
   if(saved[0]?.source_saved!==1)throw Error('source_lease_lost');
   counts.messages_read+=readCount;for(const x of classified)counts[x.decision]++;
  }catch(error){
   counts.errors++;counts.messages_read+=readCount;const codes=['telegram_rate_limited','public_history_unavailable','public_http_error','public_page_too_large','ai_not_configured','ai_rate_limited','ai_unavailable','ai_invalid_response','source_lease_lost'];
   const code=codes.includes(error?.message)?error.message:'scan_failed';
   await sql.query("update pcs_prospect_sources set access_status=$3,last_checked_at=now(),last_read_at=case when $4 then now() else last_read_at end,next_scan_at=now()+case when $3='unavailable' then interval '24 hours' else interval '1 hour' end,last_error=$5,messages_read=messages_read+$6,lease_id=null,lease_until=null,updated_at=now() where id=$1 and lease_id=$2",[s.id,run,code==='public_history_unavailable'?'unavailable':code.startsWith('ai_')?'ai_error':'http_error',readable,code,readCount]);
   if(code==='telegram_rate_limited'){
    await sql.query("update pcs_prospect_sources set lease_id=null,lease_until=null,next_scan_at=greatest(next_scan_at,now()+interval '1 hour'),last_error='telegram_rate_limited' where lease_id=$1",[run]);
    counts.sources_checked++;break;
   }
  }
  counts.sources_checked++;
 }
 await sql.query('update pcs_prospect_runs set status=$2,finished_at=now(),sources_checked=$3,messages_read=$4,qualified=$5,review=$6,rejected=$7,errors=$8 where id=$1',[run,counts.errors?'partial':'complete',counts.sources_checked,counts.messages_read,counts.qualified,counts.review,counts.rejected,counts.errors]);
 return{ok:true,run_id:run,...counts,outreach_sent:0,outreach_blocker:'telegram_user_session_not_connected'};
}
