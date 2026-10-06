// Internal AI dispatch only; authorize before reading any generation or contacting providers.
export async function generationDispatch(req,{secret,process,json}){
 if(req.method!=='POST')return json({error:'not_found'},404);
 const supplied=req.headers.get('x-pcs-internal-secret');
 if(!supplied)return json({error:'unauthorized'},401);
 let expected;try{expected=await secret('internal_retry_secret');}catch{return json({error:'authorization_unavailable'},503);}
 if(!expected||supplied!==expected)return json({error:'unauthorized'},401);
 let body;try{const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>4096)return json({error:'request_too_large'},413);body=JSON.parse(raw);}catch{return json({error:'invalid_request'},400);}
 const id=body?.generation_id;
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:'generation_id_required'},400);
 try{return json({ok:true,...await process(id)});}catch(e){console.error('pcs-generation-dispatch',{name:e instanceof Error?e.name:'Error'});return json({ok:false,error:'processing_failed'},500);}
}
