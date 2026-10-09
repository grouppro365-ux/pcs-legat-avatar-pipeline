(()=>{
 'use strict';
 if(!/^app\d+\.tgcloud\.ai$/.test(location.hostname))return;
 const nativeFetch=window.fetch.bind(window);
 const services=new Set(['pcs-manager-live2','pcs-admin-config-v14','pcs-admin-config-v15','pcs-catalog-admin','pcs-kb','pcs-contract-api','pcs-contract-files','pcs-calendar-api','pcs-ops-api','pcs-ui-api','pcs-ui-api-v9','pcs-catalog-ui-v10','pcs-errors-api']);
 const origin='https://nnlzgertmmxuteozoeel.supabase.co';
 window.fetch=async(input,init={})=>{
  if(input instanceof Request)return nativeFetch(input,init);
  const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
  const match=url.pathname.match(/^\/functions\/v1\/([a-z0-9-]+)(\/.*)?$/);
  if(url.origin!==origin||!match||!services.has(match[1]))return nativeFetch(input,init);
  const method=String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  // Login/IP throttling and large file transfers stay on their existing paths.
  if(url.searchParams.get('op')==='login'||(typeof init.body==='string'&&init.body.length>1000000)|| (init.body!=null&&typeof init.body!=='string'))return nativeFetch(input,init);
  const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));
  const token=(headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return nativeFetch(input,init);
  const api=window.Telegram?.WebApp?.Serverless;
  if(typeof api?.call!=='function')throw new Error('Обновите Telegram для доступа к PCS Serverless.');
  const payload={service:match[1],path:match[2]||'',query:[...url.searchParams.entries()],method,token,body:init.body??null};
  const result=await new Promise((resolve,reject)=>api.call('pcsApi',payload,(error,value)=>error?reject(error):resolve(value)));
  if(!result||!Number.isInteger(result.status)||result.status<200||result.status>599||typeof result.body!=='string'||typeof result.content_type!=='string')throw new Error('Ответ PCS не подтверждён. Проверьте запись перед повтором.');
  return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:{'content-type':result.content_type,'cache-control':'no-store'}});
 };
})();
