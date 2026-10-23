import {CrmError} from './crm-policy.mjs';

export const videoBucket='pcs-content-video';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const presets={reel:[1080,1920],story:[1080,1920],tiktok:[1080,1920],shorts:[1080,1920],feed:[1080,1350],pinterest:[1000,1500],landscape:[1280,720]};
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
export function videoObjectPath(job,kind){
 if(!uuid(job?.id)||!uuid(job?.claim_id)||!['video','cover'].includes(kind))throw new CrmError('Некорректный файл видеозадания',400);
 return `jobs/${job.id}/${job.claim_id}/${kind==='video'?'final.mp4':'cover.png'}`;
}
export async function signVideoUpload(storage,job,kind){
 if(job.stage!=='QA')throw new CrmError('Задание не находится на проверке файла',409);
 const path=videoObjectPath(job,kind),{data,error}=await storage.from(videoBucket).createSignedUploadUrl(path,{upsert:false});
 if(error||typeof data?.signedUrl!=='string')throw new CrmError('Не удалось подготовить загрузку видео',503);
 const url=new URL(data.signedUrl);
 if(url.origin!=='https://nnlzgertmmxuteozoeel.supabase.co'||!url.pathname.startsWith(`/storage/v1/object/upload/sign/${videoBucket}/jobs/`))throw new CrmError('Некорректное назначение загрузки',502);
 return {bucket:videoBucket,path,signed_url:data.signedUrl};
}
async function checkedBlob(storage,meta,path,cap,type){
 if(!meta||meta.bucket!==videoBucket||meta.path!==path||!sha(meta.sha256)||!Number.isSafeInteger(meta.bytes)||meta.bytes<1||meta.bytes>cap)throw new CrmError('Некорректная квитанция файла видео',400);
 const {data,error}=await storage.from(videoBucket).download(path);
 if(error||!data||data.size!==meta.bytes||data.size>cap)throw new CrmError('Файл видео не подтверждён в хранилище',409);
 const bytes=new Uint8Array(await data.arrayBuffer());
 if(type==='mp4'&&(bytes.length<12||String.fromCharCode(...bytes.slice(4,8))!=='ftyp'))throw new CrmError('Файл не является MP4',409);
 if(type==='png'&&(bytes.length<8||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)))throw new CrmError('Обложка не является PNG',409);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==meta.sha256)throw new CrmError('Контрольная сумма файла видео не совпала',409);
}
export async function verifyVideoArtifact(storage,artifact,job){
 const dims=presets[job?.spec?.preset];
 if(!dims||!artifact||artifact.width!==dims[0]||artifact.height!==dims[1]||artifact.fps!==24||!Number.isSafeInteger(artifact.frames)||artifact.frames<1||artifact.frames>1500||!Number.isFinite(artifact.duration_seconds)||artifact.duration_seconds<=0||artifact.duration_seconds>15||Math.abs(artifact.frames/24-artifact.duration_seconds)>1/24||artifact.decode_verified!==true||artifact.codec!=='h264'||artifact.technical_qa!=='PASSED'||artifact.manual_review_required!==true||artifact.source_model!=='Lightricks/LTX-Video-0.9.5'||artifact.model_revision!=='e58e28c39631af4d1468ee57a853764e11c1d37e'||!sha(artifact.manifest_sha256))throw new CrmError('Техническая проверка видео не подтверждена',409);
 const expected=job.spec.shots.reduce((sum,shot)=>sum+shot.frames/8,0);
 if(artifact.frames!==Math.round(expected*24)||Math.abs(artifact.duration_seconds-expected)>1e-6)throw new CrmError('Длительность видео не совпала с заданием',409);
 await checkedBlob(storage,artifact,videoObjectPath(job,'video'),25*1024*1024,'mp4');
 await checkedBlob(storage,artifact.cover,videoObjectPath(job,'cover'),2*1024*1024,'png');
 return artifact;
}
export async function signVideoRead(storage,job,kind){
 if(job.stage!=='READY'||!job.artifact)throw new CrmError('Результат видео ещё не готов',409);
 const path=videoObjectPath(job,kind),meta=kind==='video'?job.artifact:job.artifact.cover;
 if(meta?.bucket!==videoBucket||meta?.path!==path)throw new CrmError('Файл не принадлежит заданию',409);
 const {data,error}=await storage.from(videoBucket).createSignedUrl(path,120);
 if(error||typeof data?.signedUrl!=='string')throw new CrmError('Не удалось открыть файл видео',503);
 const u=new URL(data.signedUrl);
 if(u.origin!=='https://nnlzgertmmxuteozoeel.supabase.co'||!u.pathname.startsWith(`/storage/v1/object/sign/${videoBucket}/jobs/`))throw new CrmError('Некорректная ссылка видео',502);
 return {ok:true,url:data.signedUrl,expires_in:120,content_type:kind==='video'?'video/mp4':'image/png',filename:kind==='video'?'pcs-video.mp4':'pcs-video-cover.png'};
}
