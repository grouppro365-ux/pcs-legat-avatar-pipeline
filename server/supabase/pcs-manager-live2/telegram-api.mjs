import {Api,GrammyError,InputFile} from './telegram-sdk.mjs';
export {GrammyError,InputFile};
// Use upstream grammY without retry/queue plugins. PCS owns delivery state and receipts.
function telegramApi(token,transport,timeoutSeconds,methods){
 return new Api(token,{apiRoot:'https://api.telegram.org',timeoutSeconds,sensitiveLogs:false,baseFetchConfig:{redirect:'error'},fetch:async(url,init)=>{
  const expected='https://api.telegram.org/bot'+token+'/';
  if(typeof url!=='string'||!url.startsWith(expected)||!methods.includes(url.slice(expected.length)))throw Error('telegram_method_forbidden');
  const response=await transport(url,{...init,redirect:'error'});
  const envelope=await response.clone().json();
  if(typeof envelope?.ok!=='boolean')throw Error('telegram_receipt_invalid');
  const rejected=envelope.ok===false&&Number.isInteger(envelope.error_code)&&envelope.error_code>=400&&envelope.error_code<500&&envelope.error_code!==408;
  if(!response.ok&&!rejected)throw Error('telegram_transport_unknown');
  return response;
 }});
}

// Keep the text sender's allowlist separate from the media sender.
export function publicationTelegramApi(token,transport=fetch,timeoutSeconds=12){
 return telegramApi(token,transport,timeoutSeconds,['getMe','getChat','getChatMember','sendMessage']);
}
export function videoPublicationTelegramApi(token,transport=fetch,timeoutSeconds=30){
 return telegramApi(token,transport,timeoutSeconds,['getMe','getChat','getChatMember','sendVideo']);
}
