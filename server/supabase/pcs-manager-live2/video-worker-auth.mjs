import {CrmError} from './crm-policy.mjs';

// GitHub supplies the signature/JWKS; no long-lived worker credential is
// introduced. The entrypoint injects pinned jose.jwtVerify with a fixed JWKS.
export const videoWorkerTrust=Object.freeze({
 issuer:'https://token.actions.githubusercontent.com',
 audience:'pcs-content-video-worker',
 repository:'grouppro365-ux/pcs-legat-avatar-pipeline',
 repository_id:'1316651310',
 repository_owner_id:'268951037',
 ref:'refs/heads/main',
 workflow_ref:'grouppro365-ux/pcs-legat-avatar-pipeline/.github/workflows/pcs-content-video.yml@refs/heads/main'
});
const sha=/^[0-9a-f]{40}$/;
const positive=/^[1-9][0-9]{0,19}$/;
const deny=()=>new CrmError('Доступ видеоворкера не подтверждён',403);
const requiredClaims=['iss','aud','sub','exp','iat','nbf','repository','repository_id','repository_owner_id','ref','ref_type','workflow_ref','workflow_sha','sha','run_id','run_attempt','event_name'];

export async function authorizeVideoWorker(req,verifyJWT,{now=Date.now,onReject=()=>{}}={}){
 if(req.method!=='POST')throw new CrmError('Метод не поддерживается',405);
 const authorization=req.headers.get('authorization')||'';
 if(authorization.length>16384||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)||typeof verifyJWT!=='function')throw deny();
 const reject=(reason,extra={})=>{onReject({reason,...extra});return deny();};
 const timestamp=Number(now());
 if(!Number.isFinite(timestamp))throw deny();
 let verified;
 try{
  verified=await verifyJWT(authorization.slice(7),{
   issuer:videoWorkerTrust.issuer,audience:videoWorkerTrust.audience,
   algorithms:['RS256'],requiredClaims,maxTokenAge:'10m',clockTolerance:30,
   currentDate:new Date(timestamp)
  });
 }catch(error){
  const codes=['ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWT_EXPIRED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWKS_TIMEOUT','ERR_JWKS_NO_MATCHING_KEY','ERR_JOSE_ALG_NOT_ALLOWED'];
  const code=codes.includes(error?.code)?error.code:'VERIFIER_UNAVAILABLE';
  const claim=requiredClaims.includes(error?.claim)?error.claim:undefined;
  throw reject('JWT_VERIFICATION_FAILED',{code,...(claim?{claim}:{})});
 }
 const p=verified?.payload,h=verified?.protectedHeader,seconds=timestamp/1000;
 const foreignJobWorkflow=Boolean(p?.job_workflow_ref||p?.job_workflow_sha)&&(p?.job_workflow_ref!==videoWorkerTrust.workflow_ref||p?.job_workflow_sha!==p?.workflow_sha);
 // Recheck the trust contract here as well, so a future verifier adapter cannot
 // accidentally turn a decoded-but-unverified or broadly trusted JWT into a
 // worker. Never accept PR/fork code even if its repository name looks familiar.
 if(!p||!h||h.alg!=='RS256'||requiredClaims.some(key=>!Object.hasOwn(p,key))||
  p.iss!==videoWorkerTrust.issuer||p.aud!==videoWorkerTrust.audience||
  p.repository!==videoWorkerTrust.repository||p.repository_id!==videoWorkerTrust.repository_id||p.repository_owner_id!==videoWorkerTrust.repository_owner_id||
  p.ref!==videoWorkerTrust.ref||p.ref_type!=='branch'||p.workflow_ref!==videoWorkerTrust.workflow_ref||
  typeof p.sub!=='string'||!p.sub||p.sub.length>1000||
  typeof p.workflow_sha!=='string'||!sha.test(p.workflow_sha)||p.sha!==p.workflow_sha||
  typeof p.run_id!=='string'||!positive.test(p.run_id)||typeof p.run_attempt!=='string'||!positive.test(p.run_attempt)||
  !['push','schedule','workflow_dispatch'].includes(p.event_name)||
  Boolean(p.head_ref)||Boolean(p.base_ref)||foreignJobWorkflow||
  !Number.isInteger(p.exp)||!Number.isInteger(p.iat)||!Number.isInteger(p.nbf)||
  p.iat>seconds+30||p.nbf>seconds+30||p.exp<=seconds-30||
  p.exp<=p.iat||p.exp-p.iat>600||seconds-p.iat>630){
  const failed=[];
  if(p?.repository!==videoWorkerTrust.repository||p?.repository_id!==videoWorkerTrust.repository_id||p?.repository_owner_id!==videoWorkerTrust.repository_owner_id)failed.push('repository');
  if(p?.ref!==videoWorkerTrust.ref||p?.ref_type!=='branch')failed.push('ref');
  if(p?.workflow_ref!==videoWorkerTrust.workflow_ref||p?.sha!==p?.workflow_sha)failed.push('workflow');
  if(foreignJobWorkflow||p?.head_ref||p?.base_ref)failed.push('indirect_workflow');
  if(!['push','schedule','workflow_dispatch'].includes(p?.event_name))failed.push('event');
  if(!p||!h||h.alg!=='RS256'||requiredClaims.some(key=>!Object.hasOwn(p,key)))failed.push('required_claims');
  if(p?.iss!==videoWorkerTrust.issuer||p?.aud!==videoWorkerTrust.audience)failed.push('issuer_audience');
  if(typeof p?.sub!=='string'||!p.sub||p.sub.length>1000)failed.push('subject');
  if(typeof p?.run_id!=='string'||!positive.test(p.run_id)||typeof p?.run_attempt!=='string'||!positive.test(p.run_attempt))failed.push('run_identity');
  if(!Number.isInteger(p?.exp)||!Number.isInteger(p?.iat)||!Number.isInteger(p?.nbf)||p.iat>seconds+30||p.nbf>seconds+30||p.exp<=seconds-30||p.exp<=p.iat||p.exp-p.iat>600||seconds-p.iat>630)failed.push('token_time');
  throw reject('TRUST_CONTRACT_FAILED',{checks:failed});
 }
 // A refreshed OIDC token keeps this owner. A rerun is a different owner and
 // must acquire its own DB claim; raw JWTs and jti are never persisted/logged.
 // Run ownership + the random claim ID serialize idempotent queue operations;
 // one-time JWT consumption would incorrectly break refresh/retry/recovery.
 return Object.freeze({
  worker_id:`github:${p.run_id}:${p.run_attempt}`,run_id:p.run_id,run_attempt:p.run_attempt,
  workflow_sha:p.workflow_sha,sha:p.sha,repository_id:p.repository_id,
  workflow_ref:p.workflow_ref
 });
}
