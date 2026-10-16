import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizePurpose,contractPurpose,documentPurpose,catalogPurpose} from '../server/supabase/pcs-contract-api/purpose-auth.mjs';
const base='https://example.invalid',request=new Request(base,{headers:{authorization:'Bearer managed-session'}});
test('auxiliary services request an explicit manager purpose and reject generic session responses',async()=>{
 let call;
 assert.equal(await authorizePurpose(request,base,'contracts.write',async(url,init)=>{call={url,init};return Response.json({ok:true,purpose:'contracts.write'});}),true);
 assert.equal(call.url,base+'/functions/v1/pcs-manager-live2?op=authorize-purpose');
 assert.equal(call.init.method,'POST');assert.equal(call.init.headers.authorization,'Bearer managed-session');assert.deepEqual(JSON.parse(call.init.body),{purpose:'contracts.write'});
 for(const result of [{ok:true},{ok:true,purpose:'contracts.read'},{ok:'true',purpose:'contracts.write'},{}])assert.equal(await authorizePurpose(request,base,'contracts.write',async()=>Response.json(result)),false);
});
test('missing credentials, unknown actions and unavailable authorization fail closed before privileged access',async()=>{
 for(const [req,url,purpose] of [[new Request(base),base,'contracts.read'],[request,'','contracts.read'],[request,base,null]])assert.equal(await authorizePurpose(req,url,purpose,()=>assert.fail('authorization called')),false);
 assert.equal(await authorizePurpose(request,base,'contracts.read',async()=>new Response('private',{status:403})),false);
 assert.equal(await authorizePurpose(request,base,'contracts.read',async()=>{throw Error('unavailable')}),false);
 assert.equal(contractPurpose('DELETE'),null);assert.equal(contractPurpose('GET'),'contracts.read');assert.equal(contractPurpose('PATCH'),'contracts.write');
 assert.equal(documentPurpose('GET'),'contracts.documents.read');assert.equal(documentPurpose('POST','ocr_documents'),'contracts.documents.ocr');assert.equal(documentPurpose('POST','client_document'),'contracts.documents.write');assert.equal(documentPurpose('DELETE'),null);
 for(const [action,purpose] of [['delete','catalog.write'],['restore','catalog.write'],['rules','catalog.pricing.read'],['pricing','catalog.pricing.write'],['upsert_rule','catalog.pricing.write'],['delete_rule','catalog.pricing.write'],['unknown',null]])assert.equal(catalogPurpose(action),purpose);
});
test('all deployed auxiliary services carry the same fail-closed purpose helper and no session fallback',()=>{
 const helper=readFileSync(new URL('../server/supabase/pcs-contract-api/purpose-auth.mjs',import.meta.url),'utf8');
 for(const name of ['pcs-contract-api','pcs-contract-files','pcs-catalog-admin','pcs-telegram-set-menu']){
  assert.equal(readFileSync(new URL('../server/supabase/'+name+'/purpose-auth.mjs',import.meta.url),'utf8'),helper);
  const source=readFileSync(new URL('../server/supabase/'+name+'/index.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/op=session|from\(['"]pcs_sessions['"]\)/);assert.match(source,/authorizePurpose/);
 }
});
