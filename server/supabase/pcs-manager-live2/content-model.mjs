import {CrmError} from './crm-policy.mjs';

// Existing PCS provider configuration remains server-side. No automatic paid retries.
export async function requestContentCompletion(base,key,messages,transport=fetch,{maxTokens=3000,maxLength=12000,temperature=0.3}={}){
 const headers={apikey:key,authorization:'Bearer '+key,'content-type':'application/json'};
 const responses=await Promise.all([
  transport(base+'/rest/v1/pcs_settings?id=eq.main&select=openrouter_model',{headers,signal:AbortSignal.timeout(15000)}),
  transport(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers,body:JSON.stringify({p_name:'openrouter_key'}),signal:AbortSignal.timeout(15000)})
 ]);
 if(responses.some(r=>!r.ok))throw new CrmError('AI недоступен. Сохраните материал вручную или повторите позже.',503);
 const settings=(await responses[0].json())[0],secret=await responses[1].json();
 if(typeof secret!=='string'||!secret||typeof settings?.openrouter_model!=='string'||!settings.openrouter_model)throw new CrmError('AI не настроен. Материал можно подготовить вручную.',503);
 const response=await transport('https://openrouter.ai/api/v1/chat/completions',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},signal:AbortSignal.timeout(40000),
  body:JSON.stringify({model:settings.openrouter_model,temperature,max_tokens:maxTokens,messages})
 });
 if(!response.ok)throw new CrmError('Не удалось получить AI-черновик. Исходный материал сохранён в форме.',502);
 const data=await response.json(),choice=data?.choices?.[0];const answer=choice?.message?.content;
 if(choice?.finish_reason!=null&&choice.finish_reason!=='stop'||choice?.message?.refusal||choice?.message?.tool_calls?.length)throw new CrmError('AI не завершил черновик. Исходный текст оставлен в форме; повторите подготовку или отредактируйте вручную.',502);
 if(typeof answer!=='string'||!answer.trim()||answer.length>maxLength)throw new CrmError('AI вернул непригодный черновик. Подготовьте текст вручную.',502);
 return answer.trim();
}
