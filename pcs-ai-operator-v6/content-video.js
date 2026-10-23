(()=>{'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
 const stageNames={QUEUED:'В очереди',PREPARING:'Подготовка',GENERATING:'Генерация на GPU',POST_PROCESSING:'Монтаж',QA:'Проверка файла',READY:'Готово для редактора',FAILED:'Ошибка',CANCELLED:'Отменено'};
 const formats={reel:'Reel · 1080 × 1920',story:'Story · 1080 × 1920',tiktok:'TikTok · 1080 × 1920',shorts:'Shorts · 1080 × 1920',feed:'Лента · 1080 × 1350',landscape:'Горизонтальное · 1280 × 720'};
 const allowed={instagram:['reel','story','feed'],facebook:['reel','story','feed','landscape'],youtube:['shorts','landscape'],tiktok:['tiktok'],telegram:['landscape','story'],website:['landscape']};
 let state;
 const active=s=>state===s&&document.getElementById('pcsContentVideoRoot')===s.root&&(!s.sheet||window.pcsSheetLifecycle?.current(s.sheet))&&(!s.navigation||window.pcsNavigation?.isCurrent(s.navigation));
 const may=(s,p)=>(s.data?.permissions||[]).some(x=>x==='*'||x===p);
 const api=(op,options)=>window.pcsManagerRequest(op,options);
 const immutable=p=>['PUBLICATION_SENT','PUBLICATION_REPORTED'].includes(p.status);
 function freeze(form,value){if('disabled' in form)form.disabled=value;form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=value);}
 function command(s,element,body){const signature=JSON.stringify(body),previous=s.commands.get(element);if(previous?.signature===signature)return previous.body;const out={request_id:crypto.randomUUID(),...body};s.commands.set(element,{signature,body:out});return out;}
 async function load(s){
  if(!active(s))return;const sequence=++s.sequence;
  try{const data=await api('content-video',{method:'GET',params:{post_id:s.id,page:s.page}});if(!active(s)||sequence!==s.sequence)return;
   if(data?.post?.id!==s.id||!Array.isArray(data.jobs)||!Array.isArray(data.permissions)||data.jobs.some(j=>j.post_id!==s.id))throw Error('Некорректный ответ видеозаданий');
   s.data=data;render(s);
  }catch(error){if(active(s)&&sequence===s.sequence)s.root.querySelector('[data-video-error]').textContent=error.message||'Видеозадания не загрузились. Обновите окно.';}
 }
 async function act(s,element,body){
  if(!active(s)||s.busy)return;const payload=command(s,element,body),view=s.view;s.busy=true;freeze(element,true);
  try{const result=await api('content-video-action',{method:'POST',body:payload});if(result?.ok!==true||!result.job||!uuid(result.job.id))throw Error('Сохранение видеозадания не подтверждено. Повторите ту же команду.');
   if(active(s)&&s.view===view){s.root.querySelector('[data-video-error]').textContent='Действие сохранено. Обновляю состояние…';await load(s);}
  }catch(error){if(active(s)&&s.view===view)s.root.querySelector('[data-video-error]').textContent=error.message||'Ответ не получен. Повторите ту же команду без изменения полей.';}
  finally{s.busy=false;if(active(s)&&s.view===view)freeze(element,false);}
 }
 function jobCard(s,j){
  const current=j.revision===s.data.post.revision&&j.brand_version===s.data.post.brand_version;
  const live=['QUEUED','PREPARING','GENERATING','POST_PROCESSING','QA'].includes(j.stage);
  return `<article class="item" data-video-job="${esc(j.id)}" style="overflow-wrap:anywhere"><h4>${esc(stageNames[j.stage]||j.stage)}</h4><p>Редакция ${esc(j.revision)} · версия задания ${esc(j.version)} · ${esc(j.created_at)}</p>${!current?'<p role="alert">Материал или правила бренда изменились. Это видео нельзя считать актуальным для новой редакции.</p>':''}${j.error_code?`<p role="alert">Причина: ${esc(j.error_code)}. Автоматическая повторная генерация не запускается.</p>`:''}${j.provider_receipt?.ref?`<p>Принятая версия GPU: ${esc(j.provider_receipt.ref)}</p>`:''}${j.stage==='CANCELLED'?'<p>Результат отменён. Вычисление, которое уже началось на GPU, может завершиться позднее.</p>':''}${live&&may(s,'content.edit')?'<button class="btn soft" data-video-cancel>Отменить задание</button>':''}${j.stage==='READY'?`<p>Технические проверки файла пройдены. Бренд, язык, факты, артефакты генерации и читаемость проверяет редактор.</p><p>${esc(j.artifact?.width)} × ${esc(j.artifact?.height)} · ${esc(j.artifact?.duration_seconds)} сек · SHA-256 ${esc(j.artifact?.sha256)}</p><div class="toolbar"><button class="btn soft" data-video-preview>Смотреть видео</button><button class="btn soft" data-video-cover>Открыть обложку</button></div><div data-video-media></div>${j.review?`<p>Решение редактора: ${esc(j.review.decision||j.review.status||'сохранено')} · ${esc(j.review.note||'')}</p>`:''}${current&&may(s,'content.approve')?`<form data-video-review><label><input type="checkbox" name="confirmed" required> Я просмотрел файл и проверил язык, бренд, факты, кадры и читаемость.</label><label>Решение<select class="input" name="decision"><option value="APPROVED">Одобрить видео</option><option value="REJECTED">Отклонить видео</option></select></label><label>Комментарий<textarea class="input" name="note" required minlength="20" maxlength="2000"></textarea></label><button class="btn" type="submit">Сохранить решение по этому файлу</button></form>`:''}`:''}${j.error_code==='GPU_LAUNCH_UNKNOWN'&&may(s,'content.approve')?'<form data-video-resolve><p>Сначала проверьте принятую версию в Kaggle. Новое задание заблокировано до устранения неопределённости.</p><label><input type="checkbox" name="provider_checked" required> Проверено, что прежнее вычисление завершено или не было запущено.</label><label>Результат проверки<textarea class="input" name="note" minlength="20" maxlength="2000" required></textarea></label><button class="btn soft" type="submit">Зафиксировать проверку GPU</button></form>':''}</article>`;
 }
 function createForm(s){
  const p=s.data.post,choices=allowed[p.platform]||[];
  if(!may(s,'content.edit')||immutable(p)||!choices.length)return '';
  return `<details><summary style="min-height:44px">Новое видеозадание для редакции ${esc(p.revision)}</summary><form data-video-create><p>Текущий проверенный LTX-бэкенд создаёт исходные сцены 320 × 256, 8 кадров/сек. Экспорт увеличивает размер до формата площадки. Звук выключен. Более высокое разрешение исходника, озвучка и работа с референсами пока не поддерживаются.</p><label>Экспорт<select class="input" name="preset">${choices.map(x=>`<option value="${x}">${esc(formats[x])}</option>`).join('')}</select></label><label>Кадрирование<select class="input" name="fit"><option value="contain">Сохранить весь кадр, добавить поля</option><option value="cover">Заполнить формат с обрезкой</option></select></label><label>Сцен<select class="input" name="count"><option>1</option><option>2</option><option>3</option></select></label>${[0,1,2].map(i=>`<fieldset data-video-shot="${i}" ${i?'hidden':''}><legend>Сцена ${i+1}</legend><label>Описание сцены<textarea class="input" name="prompt_${i}" minlength="10" maxlength="2000" ${i?'':'required'}></textarea></label><label>Что исключить<textarea class="input" name="negative_${i}" maxlength="1000">text, logo, watermark, distortion</textarea></label><label>Seed<input class="input" name="seed_${i}" type="number" min="0" max="2147483647" step="1" value="${42+i}"></label><label>Длительность исходной сцены<select class="input" name="frames_${i}"><option value="17">2,125 сек</option><option value="33">4,125 сек</option></select></label></fieldset>`).join('')}<label><input type="checkbox" name="confirmed" required> Разрешаю передать только указанные описания в существующий приватный Kaggle и использовать GPU для генерации.</label><label><input type="checkbox" name="upscale_confirmed" required> Понимаю исходное разрешение и увеличение при экспорте; качество результата проверю вручную.</label><button class="btn" type="submit">Поставить в очередь</button></form></details>`;
 }
 async function media(s,j,kind,box){
  if(!active(s))return;const view=s.view,sequence=(box.pcsVideoLoad||0)+1;box.pcsVideoLoad=sequence;box.textContent='Открываю файл…';
  try{const result=await api('content-video-asset',{method:'GET',params:{job_id:j.id,kind}});if(!active(s)||view!==s.view||box.pcsVideoLoad!==sequence)return;
   const u=new URL(result.url);if(u.origin!=='https://nnlzgertmmxuteozoeel.supabase.co'||!u.pathname.startsWith('/storage/v1/object/sign/pcs-content-video/jobs/'))throw Error('Некорректная ссылка файла');
   box.innerHTML='';const el=document.createElement(kind==='video'?'video':'img');el.src=u.href;el.style.maxWidth='100%';if(kind==='video'){el.controls=true;el.preload='metadata';el.setAttribute('playsinline','');}else el.alt='Обложка видеозадания';box.appendChild(el);
  }catch(error){if(active(s)&&view===s.view&&box.pcsVideoLoad===sequence)box.textContent=error.message||'Файл не открылся';}
 }
 function render(s){
  if(!active(s))return;s.view++;const d=s.data;
  s.root.innerHTML=`<h3>${esc(d.post.title||'Видео материала PCS')}</h3><p>Редакция ${esc(d.post.revision)} · правила бренда: версия ${esc(d.post.brand_version)}. Видео остаётся приватным. Одобрение файла не запускает публикацию.</p><div class="toolbar"><button class="btn soft" data-video-refresh>Обновить</button><button class="btn soft" data-video-back>К материалу</button></div><p data-video-error role="alert"></p>${createForm(s)}<section aria-label="Видеозадания">${d.jobs.map(j=>jobCard(s,j)).join('')||'<p>Видеозаданий у этого материала пока нет.</p>'}</section><div class="toolbar">${s.page?'<button class="btn soft" data-video-prev>Назад</button>':''}${d.has_more?'<button class="btn soft" data-video-next>Далее</button>':''}</div>`;
  s.root.querySelector('[data-video-refresh]').onclick=()=>{if(active(s)&&!s.busy)load(s);};
  s.root.querySelector('[data-video-back]').onclick=()=>{if(active(s))window.pcsContent.open({id:s.id});};
  s.root.querySelector('[data-video-prev]')?.addEventListener('click',()=>{if(active(s)&&!s.busy){s.page--;load(s);}});
  s.root.querySelector('[data-video-next]')?.addEventListener('click',()=>{if(active(s)&&!s.busy){s.page++;load(s);}});
  const form=s.root.querySelector('[data-video-create]');
  if(form){form.elements.count.onchange=()=>{if(!active(s)||s.busy)return;const count=Number(form.elements.count.value);form.querySelectorAll('[data-video-shot]').forEach((el,i)=>{el.hidden=i>=count;el.querySelector('textarea').required=i<count;});};
   form.onsubmit=e=>{e.preventDefault();if(!active(s)||s.busy)return;const f=new FormData(form),count=Number(f.get('count')),shots=[];
    if(!Number.isInteger(count)||count<1||count>3)return;
    for(let i=0;i<count;i++)shots.push({prompt:String(f.get('prompt_'+i)||''),negative_prompt:String(f.get('negative_'+i)||''),seed:Number(f.get('seed_'+i)),frames:Number(f.get('frames_'+i))});
    act(s,form,{action:'create',post_id:s.id,expected_post_version:d.post.version,revision:d.post.revision,spec:{version:1,mode:'TEXT_TO_VIDEO',preset:f.get('preset'),fit:f.get('fit'),shots},confirmed:f.get('confirmed')==='on',upscale_confirmed:f.get('upscale_confirmed')==='on'});
   };
  }
  s.root.querySelectorAll('[data-video-job]').forEach(card=>{const j=d.jobs.find(x=>x.id===card.dataset.videoJob);if(!j)return;
   card.querySelector('[data-video-cancel]')?.addEventListener('click',e=>{if(active(s))act(s,e.currentTarget,{action:'cancel',job_id:j.id,expected_version:j.version});});
   card.querySelector('[data-video-preview]')?.addEventListener('click',()=>media(s,j,'video',card.querySelector('[data-video-media]')));
   card.querySelector('[data-video-cover]')?.addEventListener('click',()=>media(s,j,'cover',card.querySelector('[data-video-media]')));
   const review=card.querySelector('[data-video-review]');if(review)review.onsubmit=e=>{e.preventDefault();if(!active(s))return;const f=new FormData(review);act(s,review,{action:'review',job_id:j.id,expected_version:j.version,artifact_sha256:j.artifact.sha256,decision:f.get('decision'),confirmed:f.get('confirmed')==='on',note:f.get('note')});};
   const resolve=card.querySelector('[data-video-resolve]');if(resolve)resolve.onsubmit=e=>{e.preventDefault();if(!active(s))return;const f=new FormData(resolve);act(s,resolve,{action:'resolve-unknown',job_id:j.id,expected_version:j.version,provider_checked:f.get('provider_checked')==='on',note:f.get('note')});};
  });
 }
 async function open(post_id){
  if(!uuid(post_id))return;window.openSheet('Видео материала','<div id="pcsContentVideoRoot"><p>Загружаю видеозадания…</p><p data-video-error role="alert"></p></div>');
  const s=state={id:post_id,root:document.getElementById('pcsContentVideoRoot'),sheet:window.pcsSheetLifecycle?.capture(),navigation:window.pcsNavigation?.capture(),page:0,sequence:0,view:0,busy:false,commands:new Map()};await load(s);
 }
 window.pcsContentVideo={open};
})();
