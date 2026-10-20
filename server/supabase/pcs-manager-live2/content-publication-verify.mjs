import {CrmError} from './crm-policy.mjs';
import {sourceUsername,parsePublicPage,publicMessageWidgets} from './prospect-policy.mjs';

// Only public text is observed. Neither channel ownership nor media are verified.
export function telegramPublication(value){
 if(typeof value!=='string'||!/^https:\/\/t[.]me\/(?:s\/)?[a-z][a-z0-9_]{3,31}\/[1-9]\d{0,14}\/?$/i.test(value))throw new CrmError('Поддерживаются только прямые публичные ссылки Telegram на сообщение');
 let u;try{u=new URL(value);}catch{throw new CrmError('Нужна публичная ссылка Telegram на конкретное сообщение');}
 if(u.protocol!=='https:'||u.hostname!=='t.me'||u.port||u.username||u.password||u.search||u.hash)throw new CrmError('Нужна публичная ссылка https://t.me/канал/номер без дополнительных параметров');
 const m=u.pathname.match(/^\/(?:s\/)?([a-zA-Z][a-zA-Z0-9_]{3,31})\/([1-9]\d{0,14})\/?$/);
 if(!m)throw new CrmError('Поддерживаются только сообщения публичных Telegram-каналов');
 const username=sourceUsername(m[1]),id=m[2];
 return {username,id,url:`https://t.me/${username}/${id}`,fetch_url:`https://t.me/s/${username}?before=${BigInt(id)+1n}`};
}
export const normalizePublicationText=value=>String(value).normalize('NFC').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
async function hash(text){const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function boundedHtml(response,maxBytes){
 const length=Number(response.headers.get('content-length'));if(length>maxBytes){await response.body?.cancel();throw Error('page_too_large');}
 if(!response.body)throw Error('page_unreadable');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('page_too_large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function observeTelegramPublication(snapshot,{fetcher=fetch,timeoutMs=12000,maxBytes=2000000}={}){
 const target=telegramPublication(snapshot.publication_url),expected=normalizePublicationText(snapshot.body);
 if(!expected||[...expected].length>4096)throw new CrmError('Одобренный текст не подходит для проверки Telegram');
 const evidence={method:'public_telegram_text_v1',outcome:'UNREADABLE',reason:'page_unavailable',publication_url:target.url,fetch_url:target.fetch_url,message_id:target.id,username:target.username,expected_sha256:await hash(expected),observed_sha256:null,published_at:null};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetcher(target.fetch_url,{redirect:'manual',signal:controller.signal});
  if(response.status>=300&&response.status<400){await response.body?.cancel();evidence.reason='redirect_refused';return evidence;}
  if(!response.ok){await response.body?.cancel();return evidence;}
  const html=await boundedHtml(response,maxBytes);
  // Bound parsing to the complete exact widget, independent of attribute order.
  // A missing/deleted target must never borrow a later message's text or time.
  const widgets=publicMessageWidgets(html).filter(x=>x.post===`${target.username}/${target.id}`);
  if(widgets.length!==1){evidence.reason=widgets.length?'ambiguous_message':'message_missing';return evidence;}
  const block=widgets[0].block;
  const raw=block.match(/<div\b[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if(!raw||[...block.matchAll(/class="[^"]*tgme_widget_message_text[\s"]/gi)].length!==1||/<div\b|<time\b|data-post=|tgme_widget_message_text_read_more|js-message_text_more/i.test(raw[1])){evidence.reason='text_unreadable';return evidence;}
  const message=parsePublicPage(block,target.username).messages.find(m=>m.id===target.id);
  if(!message?.published_at||!message.text||message.text.length>=12000){evidence.reason='text_unreadable';return evidence;}
  const actual=normalizePublicationText(message.text);evidence.observed_sha256=await hash(actual);evidence.published_at=message.published_at;
  evidence.outcome=actual===expected?'TEXT_MATCH':'TEXT_MISMATCH';evidence.reason=actual===expected?'exact_text_observed':'different_text_observed';
  return evidence;
 }catch(e){evidence.reason=controller.signal.aborted?'fetch_timeout':e.message==='page_too_large'?'page_too_large':'page_unavailable';return evidence;}
 finally{clearTimeout(timer);}
}

export async function verifyContentPublication(biz,b,actor,permissions,options){
 const params=[JSON.stringify(b),String(actor),JSON.stringify(permissions)];
 const query='select pcs.content_verify_publication($1::jsonb,$2,$3::jsonb,$4::jsonb) result';
 const prepare=(await biz.query(query,[...params,null]))[0]?.result;
 if(prepare?.verification_required!==true){if(prepare?.ok!==true)throw new CrmError('Не получено подтверждение проверки',502);return prepare;}
 const observation=await observeTelegramPublication(prepare.snapshot,options);
 const result=(await biz.query(query,[...params,JSON.stringify(observation)]))[0]?.result;
 if(result?.ok!==true||result.id!==b.id||!result.verification)throw new CrmError('Не получено подтверждение сохранения проверки. Повторите ту же команду.',502);
 return result;
}
