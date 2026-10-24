import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeVideoWorker,videoWorkerTrust} from '../server/supabase/pcs-manager-live2/video-worker-auth.mjs';

const now=Date.parse('2026-10-23T16:30:00Z'),seconds=now/1000;
const token='aaa.bbb.ccc';
const req=(authorization='Bearer '+token,method='POST')=>new Request('https://pcs.example/worker',{method,headers:{authorization}});
const payload=()=>({
 ...videoWorkerTrust,sub:'repo:grouppro365-ux/pcs-legat-avatar-pipeline:ref:refs/heads/main',
 iss:videoWorkerTrust.issuer,aud:videoWorkerTrust.audience,ref_type:'branch',
 workflow_sha:'a'.repeat(40),sha:'a'.repeat(40),run_id:'39984787683',run_attempt:'1',
 event_name:'workflow_dispatch',iat:seconds-30,nbf:seconds-30,exp:seconds+270
});
const verified=(p=payload(),header={alg:'RS256',typ:'JWT'})=>async()=>({payload:p,protectedHeader:header});
const authorize=(p=payload(),header)=>authorizeVideoWorker(req(),verified(p,header),{now:()=>now});

test('video worker passes fixed jose verification options and returns only run-bound identity',async()=>{
 let seen;
 const identity=await authorizeVideoWorker(req(),async(raw,options)=>{seen={raw,options};return {payload:payload(),protectedHeader:{alg:'RS256'}};},{now:()=>now});
 assert.equal(seen.raw,token);assert.equal(seen.options.issuer,videoWorkerTrust.issuer);assert.equal(seen.options.audience,'pcs-content-video-worker');
 assert.deepEqual(seen.options.algorithms,['RS256']);assert.equal(seen.options.maxTokenAge,'10m');
 for(const key of ['exp','iat','nbf','repository_id','workflow_ref','workflow_sha','run_id','run_attempt'])assert.ok(seen.options.requiredClaims.includes(key));
 assert.equal(seen.options.currentDate.getTime(),now);
 assert.deepEqual(identity,{worker_id:'github:39984787683:1',run_id:'39984787683',run_attempt:'1',workflow_sha:'a'.repeat(40),sha:'a'.repeat(40),repository_id:'1316651310',workflow_ref:videoWorkerTrust.workflow_ref});
 assert.ok(Object.isFrozen(identity));assert.equal(Object.hasOwn(identity,'token'),false);
});

test('all supported main workflow triggers retain identity and refreshing does not create another owner',async()=>{
 const owner=(await authorize()).worker_id;
 for(const event_name of ['push','schedule','workflow_dispatch'])assert.equal((await authorize({...payload(),event_name,iat:seconds,nbf:seconds,exp:seconds+300})).worker_id,owner);
 assert.equal((await authorize({...payload(),run_attempt:'2'})).worker_id,'github:39984787683:2');
 assert.equal((await authorize({...payload(),sub:'repo:grouppro365-ux@268951037/pcs-legat-avatar-pipeline@1316651310:ref:refs/heads/main'})).worker_id,owner);
 assert.equal((await authorize({...payload(),job_workflow_ref:videoWorkerTrust.workflow_ref,job_workflow_sha:payload().workflow_sha})).worker_id,owner);
 for(const patch of [{job_workflow_ref:videoWorkerTrust.workflow_ref,job_workflow_sha:'b'.repeat(40)},{job_workflow_ref:'other/workflow@refs/heads/main',job_workflow_sha:payload().workflow_sha}])await assert.rejects(authorize({...payload(),...patch}),{status:403});
});

test('a renamed or forked repository, non-main code and another workflow are refused',async()=>{
 const patches=[
  {repository_id:'1316651311'},{repository_id:1316651310},{repository:'fork/pcs-legat-avatar-pipeline'},
  {repository_owner_id:'1'},{repository_owner_id:268951037},{ref:'refs/heads/feature'},
  {ref:'refs/pull/1/merge'},{ref_type:'tag'},{workflow_ref:videoWorkerTrust.workflow_ref.replace('pcs-content-video.yml','daily-kaggle.yml')},
  {workflow_ref:videoWorkerTrust.workflow_ref.replace('@refs/heads/main','@refs/heads/feature')},
  {sha:'b'.repeat(40)},{workflow_sha:'x'.repeat(40),sha:'x'.repeat(40)},
  {head_ref:'feature'},{base_ref:'main'},{job_workflow_ref:'other/reusable@refs/heads/main'},
  {job_workflow_sha:'a'.repeat(40)}
 ];
 for(const patch of patches)await assert.rejects(authorize({...payload(),...patch}),{status:403});
});

test('PR and indirect workflow triggers cannot borrow a trusted main-workflow name',async()=>{
 for(const event_name of ['pull_request','pull_request_target','workflow_run','repository_dispatch','dynamic',''])
  await assert.rejects(authorize({...payload(),event_name}),{status:403});
});

test('signature errors, wrong algorithms, issuer and audience never authorize',async()=>{
 for(const alg of ['HS256','EdDSA','none',undefined])await assert.rejects(authorize(payload(),{alg}),{status:403});
 for(const patch of [{iss:'https://attacker.example'},{aud:'another-worker'},{aud:['pcs-content-video-worker','another-worker']}])
  await assert.rejects(authorize({...payload(),...patch}),{status:403});
 await assert.rejects(authorizeVideoWorker(req(),async()=>{throw Error('sensitive verification error '+token)},{now:()=>now}),e=>e.status===403&&!e.message.includes(token)&&!e.message.includes('sensitive'));
 await assert.rejects(authorizeVideoWorker(req(),async()=>payload(),{now:()=>now}),{status:403});
});

test('missing, expired, future and excessive-lifetime tokens are refused even by a permissive adapter',async()=>{
 for(const key of ['sub','exp','iat','nbf','repository_id','repository_owner_id','ref','workflow_ref','workflow_sha','sha','run_id','run_attempt','event_name']){
  const p=payload();delete p[key];await assert.rejects(authorize(p),{status:403});
 }
 for(const patch of [{exp:seconds-31},{iat:seconds+31},{nbf:seconds+31},{exp:seconds+601,iat:seconds},
  {iat:seconds-631,exp:seconds+10},{exp:'123'},{iat:1.1},{nbf:NaN},{run_id:'0'},
  {run_id:'1/../../x'},{run_id:39984787683},{run_attempt:'0'},{run_attempt:1},{run_attempt:'1.0'},{sub:''}])
  await assert.rejects(authorize({...payload(),...patch}),{status:403});
});

test('method and authorization syntax checks stop before the verifier',async()=>{
 let calls=0;const verify=async()=>{calls++;return {payload:payload(),protectedHeader:{alg:'RS256'}};};
 for(const authorization of ['',token,'Basic '+token,'Bearer a.b','Bearer '+token+' extra','Bearer '+'.'.repeat(20000)])
  await assert.rejects(authorizeVideoWorker(req(authorization),verify,{now:()=>now}),{status:403});
 await assert.rejects(authorizeVideoWorker(req('Bearer '+token,'GET'),verify,{now:()=>now}),{status:405});
 assert.equal(calls,0);
});

test('rejection diagnostics expose fixed codes and check names, never tokens or raw claims',async()=>{
 const diagnostics=[];
 const onReject=value=>diagnostics.push(value);
 await assert.rejects(authorizeVideoWorker(req(),async()=>{throw Object.assign(Error('private '+token),{code:'ERR_JWT_CLAIM_VALIDATION_FAILED',claim:'aud'});},{now:()=>now,onReject}),{status:403});
 assert.deepEqual(diagnostics.pop(),{reason:'JWT_VERIFICATION_FAILED',code:'ERR_JWT_CLAIM_VALIDATION_FAILED',claim:'aud'});
 await assert.rejects(authorizeVideoWorker(req(),verified({...payload(),ref:'private-branch-name'}),{now:()=>now,onReject}),{status:403});
 assert.deepEqual(diagnostics.pop(),{reason:'TRUST_CONTRACT_FAILED',checks:['ref']});
 await assert.rejects(authorizeVideoWorker(req(),async()=>{throw Object.assign(Error(token),{code:'secret-code',claim:'private-claim'});},{now:()=>now,onReject}),{status:403});
 assert.deepEqual(diagnostics.pop(),{reason:'JWT_VERIFICATION_FAILED',code:'VERIFIER_UNAVAILABLE'});
});
