import {CrmError,readCrmBody} from './crm-policy.mjs';
import {authorizeVideoWorker} from './video-worker-auth.mjs';
import {videoWorkerAction} from './content-video.mjs';
import {signVideoUpload,verifyVideoArtifact} from './content-video-storage.mjs';

export async function contentVideoWorkerRoute(req,{biz,storage,verifyJWT}){
 const identity=await authorizeVideoWorker(req,verifyJWT,{onReject:details=>console.warn('pcs-video-worker-auth',details)});
 const body=await readCrmBody(req,131072),{action,...payload}=body;
 if(action==='upload'){
  if(Object.keys(payload).some(k=>!['request_id','job_id','claim_id','expected_version','kind'].includes(k))||!['video','cover'].includes(payload.kind))throw new CrmError('Некорректный запрос загрузки видео',400);
  const {kind,...read}=payload,result=await videoWorkerAction(biz,'read',read,identity);
  if(!result?.job)throw new CrmError('Видеозадание не найдено',404);
  return {...result,upload:await signVideoUpload(storage,result.job,kind)};
 }
 return videoWorkerAction(biz,action,payload,identity,(artifact,job)=>verifyVideoArtifact(storage,artifact,job));
}
