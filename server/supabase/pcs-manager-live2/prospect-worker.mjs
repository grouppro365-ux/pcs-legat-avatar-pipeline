import {scanProspects,prospectAI,classifyReviewProspects} from './prospect-engine.mjs';
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export async function internalProspectScan(req,{base,key,op},transport=fetch){
 if(req.method!=='POST')return {status:405,body:{error:'method_not_allowed'}};
 const supplied=req.headers.get('x-pcs-internal-secret');
 if(!supplied)return {status:401,body:{error:'unauthorized'}};
 try{
  const r=await transport(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_name:'internal_retry_secret'}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return {status:503,body:{error:'worker_unavailable'}};
  const expected=await r.json();
  if(!expected||!equal(supplied,expected))return {status:401,body:{error:'unauthorized'}};
  if(new URL(req.url).searchParams.get('mode')==='classify-review')return{status:200,body:await classifyReviewProspects(op,()=>prospectAI(base,key,transport),{transport})};
  const publicReview=new URL(req.url).searchParams.get('mode')==='public-review';
  const loadAI=publicReview?async()=>({model:'local-review-only',classify:async messages=>messages.map(m=>({...m,decision:'review',direction:null,reason:'Публичное сообщение прочитано. Классификация внешней моделью ещё не выполнена.',evidence:null,facts:{},outreach_status:'blocked_identity'}))}):()=>prospectAI(base,key,transport);
  const result=await scanProspects(op,loadAI,{transport,limit:1});
  return {status:200,body:result};
 }catch(e){return {status:e?.status===409?409:503,body:{error:e?.status===409?'prospecting_paused':'worker_unavailable'}};}
}
