import {CrmError} from './crm-policy.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x)&&x>0&&x<1e9;
const own=(b,keys)=>plain(b)&&Object.keys(b).every(k=>keys.includes(k));
const fail=(message='Проверьте данные видеозадания',status=400)=>{throw new CrmError(message,status)};
export const videoCapabilities={modes:['TEXT_TO_VIDEO'],presets:['reel','story','tiktok','shorts','feed','pinterest','landscape'],max_shots:3,source_width:320,source_height:256,source_fps:8,frames:[17,33],inference_steps:30,requires_upscale_confirmation:true,manual_review_required:true,automatic_publication:false};
export function videoSpec(spec){
 if(!own(spec,['version','mode','preset','fit','shots'])||spec.version!==1||spec.mode!=='TEXT_TO_VIDEO'||!videoCapabilities.presets.includes(spec.preset)||!['contain','cover'].includes(spec.fit)||!Array.isArray(spec.shots)||spec.shots.length<1||spec.shots.length>3)fail();
 let total=0;for(const shot of spec.shots){if(!own(shot,['prompt','negative_prompt','seed','frames'])||typeof shot.prompt!=='string'||shot.prompt.trim().length<10||shot.prompt.length>2000||typeof shot.negative_prompt!=='string'||shot.negative_prompt.length>1000||!Number.isSafeInteger(shot.seed)||shot.seed<0||shot.seed>2147483647||![17,33].includes(shot.frames))fail();total+=shot.frames;}if(total>99)fail();return spec;
}
export function contentVideoInput(action,b){
 const fields={create:['request_id','post_id','expected_post_version','revision','spec','confirmed','upscale_confirmed'],cancel:['request_id','job_id','expected_version'],review:['request_id','job_id','expected_version','decision','confirmed','note','artifact_sha256'],'resolve-unknown':['request_id','job_id','expected_version','provider_checked','note']};
 if(!fields[action]||!own(b,fields[action])||!uuid(b.request_id))fail();
 if(action==='create'){if(!uuid(b.post_id)||!integer(b.expected_post_version)||!integer(b.revision)||b.confirmed!==true||b.upscale_confirmed!==true)fail('Подтвердите передачу задания в GPU и масштабирование исходного видео');videoSpec(b.spec);}
 else {if(!uuid(b.job_id)||!integer(b.expected_version))fail();if(action!=='cancel'&&(typeof b.note!=='string'||b.note.trim().length<20||b.note.length>4000))fail('Добавьте обоснование проверки от 20 до 4000 символов');if(action==='review'&&(!['APPROVED','REJECTED'].includes(b.decision)||b.confirmed!==true||typeof b.artifact_sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.artifact_sha256)))fail('Подтвердите проверку именно этого файла');if(action==='resolve-unknown'&&b.provider_checked!==true)fail('Проверьте состояние задания у провайдера перед повторным запуском');}
 return b;
}
function databaseError(error){
 if(error instanceof CrmError)throw error;const message=String(error?.message||'');
 if(error?.code==='42501'||/content_video_(forbidden|worker_forbidden)/.test(message))fail('Недостаточно прав для видеозадания',403);
 if(error?.code==='40001'||/content_video_(version_conflict|snapshot_changed|live_job_exists|job_locked|review_stale|stage_invalid|request_conflict)/.test(message))fail('Видеозадание или материал изменились. Обновите карточку.',409);
 if(error?.code==='22023'||/content_video_/.test(message))fail('Проверьте формат задания, этап и подтверждение проверки',400);
 throw error;
}
export async function readContentVideo(biz,input={}){
 if(!own(input,['post_id','job_id','page'])||(input.post_id!=null&&!uuid(input.post_id))||(input.job_id!=null&&!uuid(input.job_id))||input.post_id&&input.job_id)fail();
 const page=Number(input.page??0);if(!Number.isSafeInteger(page)||page<0||page>1000)fail();
 const post=input.post_id?(await biz.query(`select p.id,p.version,p.status,r.revision,b.version brand_version,r.platform,r.title,b.name brand_name from pcs.content_posts p join pcs.content_brands b on b.id=p.brand_id join lateral(select revision,platform,title from pcs.content_revisions where post_id=p.id order by revision desc limit 1)r on true where p.id=$1::uuid`,[input.post_id]))[0]:null;
 if(input.post_id&&!post)fail('Материал не найден',404);
 const rows=await biz.query(`select pcs.content_video_job(j) job from public.pcs_workflow_outbox j where j.aggregate_type='CONTENT_POST' and j.event_type='CONTENT_VIDEO_GENERATION' and ($1::uuid is null or j.aggregate_id=$1::uuid) and ($2::uuid is null or j.id=$2::uuid) order by j.created_at desc,j.id limit 21 offset $3`,[input.post_id||null,input.job_id||null,input.job_id?0:page*20]);
 return {ok:true,post,jobs:rows.slice(0,20).map(x=>x.job),has_more:rows.length>20,page,capabilities:videoCapabilities};
}
export async function actContentVideo(biz,action,b,actor,permissions){
 b=contentVideoInput(action,b);const required=['review','resolve-unknown'].includes(action)?'content.approve':'content.edit';
 if(!Array.isArray(permissions)||!permissions.some(p=>p==='*'||p===required))fail('Недостаточно прав для видеозадания',403);
 try{const result=(await biz.query('select pcs.content_video_action($1,$2::jsonb,$3,$4::jsonb) result',[action,JSON.stringify(b),String(actor),JSON.stringify(permissions)]))[0]?.result;if(result?.ok!==true||!uuid(result.job?.id)||action!=='create'&&result.job.id!==b.job_id||action==='create'&&result.job.post_id!==b.post_id)fail('Не получено подтверждение видеозадания. Повторите ту же команду.',502);return result;}catch(error){databaseError(error);}
}
const workerFields={claim:['request_id'],read:['request_id','job_id','claim_id','expected_version'],progress:['request_id','job_id','claim_id','expected_version','stage','provider_receipt'],complete:['request_id','job_id','claim_id','expected_version','artifact'],fail:['request_id','job_id','claim_id','expected_version','error_code']};
const errorCodes=['VIDEO_PREPARATION_FAILED','GPU_LAUNCH_UNKNOWN','VIDEO_GENERATION_FAILED','VIDEO_POSTPROCESS_FAILED','VIDEO_UPLOAD_FAILED','WORKER_INTERRUPTED','QA_FAILED','PROVIDER_UNAVAILABLE'];
export function videoWorkerInput(action,b){
 if(!workerFields[action]||!own(b,workerFields[action])||!uuid(b.request_id))fail('Некорректная команда видеопроцесса');
 if(action!=='claim'&&(!uuid(b.job_id)||!uuid(b.claim_id)||!integer(b.expected_version)))fail('Некорректная привязка видеопроцесса');
 if(action==='progress'){
  if(!['GENERATING','POST_PROCESSING','QA'].includes(b.stage))fail('Некорректный этап видео');
  if(b.provider_receipt!=null){const p=b.provider_receipt;if(!own(p,['kernel','version','ref','run_id'])||p.kernel!=='tatyanathai/pcs-legat-ai-avatar-pipeline'||!integer(p.version)||p.ref!==p.kernel+'/'+p.version||p.run_id!==b.claim_id)fail('Некорректная квитанция GPU');}
 }
 if(action==='fail'&&!errorCodes.includes(b.error_code))fail('Некорректный код ошибки видео');
 if(action==='complete'&&!plain(b.artifact))fail('Не получен файл видео');return b;
}
export async function videoWorkerAction(biz,action,b,identity,verifyArtifact){
 b=videoWorkerInput(action,b);if(!/^github:[1-9]\d{3,19}:[1-9]\d{0,5}$/.test(identity?.worker_id||'')||!/^[a-f0-9]{40}$/.test(identity?.workflow_sha||''))fail('Видеопроцесс не авторизован',403);
 const query=async(act,payload)=>{try{const out=(await biz.query('select pcs.content_video_worker($1,$2::jsonb,$3,$4) result',[act,JSON.stringify(payload),identity.worker_id,identity.workflow_sha]))[0]?.result;if(out?.ok!==true||out.job!=null&&(!uuid(out.job.id)||act!=='claim'&&out.job.id!==payload.job_id))fail('Не получено подтверждение этапа видео',502);return out;}catch(error){databaseError(error);}};
 if(action==='complete'){
  if(typeof verifyArtifact!=='function')fail('Проверка файла видео не подключена',503);
  const current=await query('read',{request_id:crypto.randomUUID(),job_id:b.job_id,claim_id:b.claim_id,expected_version:b.expected_version});
  if(current.job?.stage==='READY'&&current.job.artifact?.sha256===b.artifact.sha256)return query(action,b);
  if(current.stopped||current.job?.stage!=='QA'||current.job.version!==b.expected_version)fail('Задание изменилось до проверки файла',409);
  b={...b,artifact:await verifyArtifact(b.artifact,current.job)};
 }
 const out=await query(action,b);if(action==='read'&&out.job&&out.job.version!==b.expected_version)fail('Видеозадание изменилось',409);return out;
}
