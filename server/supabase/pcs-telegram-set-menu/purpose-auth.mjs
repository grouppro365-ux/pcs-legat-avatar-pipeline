// Every caller is authorized for one explicit purpose. Authentication alone never grants access.
export async function authorizePurpose(request, base, purpose, fetcher=fetch) {
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization)||!base||!purpose)return false;
 try {
  const response=await fetcher(base+'/functions/v1/pcs-manager-live2?op=authorize-purpose',{
   method:'POST',headers:{authorization,'content-type':'application/json'},
   body:JSON.stringify({purpose}),signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)return false;
  const result=await response.json();
  return result?.ok===true&&result?.purpose===purpose;
 }catch{return false;}
}
export function contractPurpose(method){return method==='GET'?'contracts.read':['POST','PATCH'].includes(method)?'contracts.write':null;}
export function documentPurpose(method,kind){
 if(method==='GET')return 'contracts.documents.read';
 if(method!=='POST')return null;
 return kind==='ocr_documents'?'contracts.documents.ocr':'contracts.documents.write';
}
export function catalogPurpose(action){
 if(['delete','restore'].includes(action))return 'catalog.write';
 if(action==='rules')return 'catalog.pricing.read';
 if(['pricing','upsert_rule','delete_rule'].includes(action))return 'catalog.pricing.write';
 return null;
}
