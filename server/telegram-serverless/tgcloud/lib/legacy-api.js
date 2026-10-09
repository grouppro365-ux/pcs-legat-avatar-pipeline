// Phase 1 keeps canonical PostgreSQL and every existing admin permission check.
const base='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/';
const services=new Set(['pcs-manager-live2','pcs-admin-config-v14','pcs-admin-config-v15','pcs-catalog-admin','pcs-kb','pcs-contract-api','pcs-contract-files','pcs-calendar-api','pcs-ops-api','pcs-ui-api','pcs-ui-api-v9','pcs-catalog-ui-v10','pcs-errors-api']);
export function prepareRequest(input,ctx){
 if(!Number.isSafeInteger(ctx?.initData?.user?.id)||ctx.initData.user.id<=0||ctx.initData.user.is_bot)throw new Error('telegram_user_required');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['service','path','query','method','token','body'].includes(k)))throw new Error('invalid_request');
 if(!services.has(input.service)||!['GET','POST','PUT','PATCH','DELETE'].includes(input.method))throw new Error('unsupported_route');
 const path=input.path||'';
 if(typeof path!=='string'||path.length>2000||(path!==''&&!/^\/[A-Za-z0-9_/-]+$/.test(path)))throw new Error('invalid_path');
 if(typeof input.token!=='string'||!input.token||input.token.length>4096||/[\r\n]/.test(input.token))throw new Error('admin_session_required');
 const query=input.query||[];
 if(!Array.isArray(query)||query.length>30||query.some(x=>!Array.isArray(x)||x.length!==2||x.some(v=>typeof v!=='string'||v.length>2000)))throw new Error('invalid_query');
 if(input.service==='pcs-manager-live2'&&query.some(([k,v])=>k==='op'&&['login','prospecting-worker','followup-reminder-worker'].includes(v)))throw new Error('unsupported_operation');
 if(input.body!=null&&(typeof input.body!=='string'||input.body.length>1000000||input.method==='GET'))throw new Error('invalid_body');
 if(input.body!=null){try{JSON.parse(input.body)}catch{throw new Error('invalid_json')}}
 const suffix=query.length?'?'+query.map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&'):'';
 return {url:base+input.service+path+suffix,options:{method:input.method,headers:{authorization:'Bearer '+input.token,accept:'application/json',...(input.body!=null?{'content-type':'application/json'}:{})},...(input.body!=null?{body:input.body}:{})}};
}
export async function forwardRequest(input,ctx,fetch){
 const request=prepareRequest(input,ctx),response=await fetch(request.url,request.options);
 const body=await response.text();
 if(!Number.isInteger(response.status)||response.status<200||response.status>599||body.length>5000000)throw new Error('invalid_upstream_response');
 return {status:response.status,body,content_type:response.headers.get('content-type')||'application/json;charset=utf-8'};
}
