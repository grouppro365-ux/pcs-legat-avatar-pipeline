(()=>{
let KB=[],knowledgeEdit=null;
function visLabel(v){return v==='customer_safe'?'Можно клиенту':v==='approval_only'?'С согласованием':'Только внутреннее'}
function statusLabel(s){return ({active:'Активно',draft:'Черновик',outdated:'Устарело',disabled:'Отключено'})[s]||s||'—'}
function categoryLabel(v){return typeof pcsIntentRu==='function'?pcsIntentRu(v):v}
window.kb=async function(){const m=document.querySelector('#main');m.innerHTML=`<div class="eyebrow">Контекст ИИ</div><h1 class="title">База знаний</h1><p class="sub">Источник актуальных фактов для ответов ИИ. Автоматический ответ использует только активные записи «Можно клиенту».</p><div class="ops-head"><div id="kbStats" class="pills"></div><button class="btn" onclick="editKnowledge()">+ Добавить запись</button></div><div id="kbList" class="list">Загрузка…</div>`;try{KB=await call('/knowledge');const active=KB.filter(x=>x.status==='active').length,approval=KB.filter(x=>x.visibility==='approval_only').length,internal=KB.filter(x=>x.visibility==='internal_only').length;document.querySelector('#kbStats').innerHTML=`<span class="pill">Активно ${active}</span><span class="pill warn">С согласованием ${approval}</span><span class="pill">Внутренние ${internal}</span>`;document.querySelector('#kbList').innerHTML=KB.length?KB.map(v=>`<div class="item"><div class="pills"><span class="pill ${v.status==='active'?'':'warn'}">${esc(statusLabel(v.status))}</span><span class="pill">${esc(visLabel(v.visibility))}</span><span class="pill">версия ${Number(v.revision||1)}</span></div><h3>${esc(v.title||'Запись')}</h3><p data-user-content>${esc(v.description||'')}</p><div class="booking-meta">${v.category?`<span>${esc(categoryLabel(v.category))}</span>`:''}${v.city?`<span>${esc(v.city)}</span>`:''}${v.price!=null?`<span>${esc(String(v.price))} ${esc(v.currency||'')}</span>`:''}${v.valid_until?`<span>до ${esc(String(v.valid_until).slice(0,10))}</span>`:''}</div><div class="toolbar" style="margin-top:10px"><button class="btn soft" onclick="editKnowledge('${v.id}')">Редактировать</button></div></div>`).join(''):'<div class="empty">База знаний пуста</div>'}catch(e){document.querySelector('#kbList').textContent=e.message}};
window.editKnowledge=function(id){const records=[...(Array.isArray(window.__PCS_KB_ROWS__)?window.__PCS_KB_ROWS__:[]),...KB];const x=id?records.find(v=>String(v.id)===String(id)):null;knowledgeEdit={id:id||'',revision:x?.revision,createId:null,busy:false,attempted:null};openSheet(x?'Редактировать запись':'Новая запись',`${x?`<button class="btn soft" style="margin-bottom:12px" onclick="knowledgePhotos('${x.id}')">Фото — добавить или удалить пачкой</button><p class="muted">Перед открытием фото сохраните изменения текста.</p>`:'<p class="muted">Сначала сохраните запись, затем добавьте фото.</p>'}<div class="grid2"><div class="field"><label>Название</label><input id="kTitle" value="${esc(x?.title||'')}"></div><div class="field"><label>Категория запроса</label><input id="kCategory" value="${esc(x?.category||'')}" placeholder="Например: car_rent"></div><div class="field"><label>Город</label><input id="kCity" value="${esc(x?.city||'')}"></div><div class="field"><label>Доступ</label><select id="kVisibility" data-pcs-localized><option value="customer_safe" ${x?.visibility==='customer_safe'?'selected':''}>Можно клиенту</option><option value="approval_only" ${x?.visibility==='approval_only'?'selected':''}>С согласованием</option><option value="internal_only" ${x?.visibility==='internal_only'?'selected':''}>Только внутреннее</option></select></div><div class="field"><label>Статус</label><select id="kStatus" data-pcs-localized>${['active','draft','outdated','disabled'].map(v=>`<option value="${v}" ${(x?.status||'draft')===v?'selected':''}>${statusLabel(v)}</option>`).join('')}</select></div></div><div class="field"><label>Подтверждённая информация</label><textarea id="kDescription">${esc(x?.description||'')}</textarea></div><div class="grid2"><div class="field"><label>Цена</label><input id="kPrice" type="text" inputmode="decimal" value="${esc(x?.price??'')}"></div><div class="field"><label>Валюта</label><input id="kCurrency" value="${esc(x?.currency||'THB')}"></div><div class="field"><label>Источник</label><input id="kSource" value="${esc(x?.source||'')}"></div><div class="field"><label>Действительно до</label><input id="kValid" type="text" inputmode="numeric" placeholder="2026-12-31" value="${x?.valid_until?esc(String(x.valid_until).slice(0,10)):''}"></div></div><div class="field"><label>Условия</label><textarea id="kConditions">${esc(x?.conditions||'')}</textarea></div><div class="field"><label>Ограничения</label><textarea id="kRestrictions">${esc(x?.restrictions||'')}</textarea></div><div class="field"><label>Инструкция для ИИ</label><textarea id="kGuidance">${esc(x?.answer_guidance||'')}</textarea></div><div class="field"><label>Комментарий для администратора</label><textarea id="kComment">${esc(x?.operator_comment||'')}</textarea></div><label class="toggle-row"><input id="kAuto" type="checkbox" ${x?.auto_answer_allowed?'checked':''}><span><b>Разрешить автоматический ответ</b><br><span class="muted">Сработает только для доступа «Можно клиенту». Цена и сроки должны быть подтверждены в этой записи.</span></span></label><p id="kSaveError" role="alert" class="contract-fact-error"></p><button id="kSave" class="btn" style="width:100%;margin-top:12px" onclick="saveKnowledge('${id||''}')">Сохранить</button>`)};
window.saveKnowledge=async function(id){
 const s=knowledgeEdit;if(!s||s.id!==(id||'')||s.busy)return;
 const error=document.querySelector('#kSaveError'),button=document.querySelector('#kSave'),fields=[...(document.querySelectorAll?.('.sheetbox input,.sheetbox textarea,.sheetbox select')||[])];
 try{
  const value=id=>document.querySelector('#'+id).value.trim(),title=value('kTitle'),category=value('kCategory'),description=value('kDescription'),valid=value('kValid');
  if(!title||!category||!description)throw Error('Название, категория и информация обязательны');
  if(valid&&!/^\d{4}-\d{2}-\d{2}$/.test(valid))throw Error('Дата должна быть ГГГГ-ММ-ДД');
  if(!id&&!s.createId)s.createId=crypto.randomUUID();
  const body=s.attempted||{title,category,description,city:value('kCity')||null,visibility:value('kVisibility'),status:value('kStatus'),price:value('kPrice')||null,currency:value('kCurrency').toUpperCase()||null,source:value('kSource')||null,valid_until:valid?valid+'T23:59:59Z':null,conditions:value('kConditions')||null,restrictions:value('kRestrictions')||null,answer_guidance:value('kGuidance')||null,operator_comment:value('kComment')||null,auto_answer_allowed:document.querySelector('#kAuto').checked,...(id?{expected_revision:s.revision}:{id:s.createId})};
  s.busy=true;s.attempted=body;button.disabled=true;fields.forEach(x=>x.disabled=true);error.textContent='';
  await call('/knowledge'+(id?'/'+id:''),{method:id?'PATCH':'POST',body:JSON.stringify(body)});
  if(knowledgeEdit===s&&document.querySelector('#kSave')===button){closeSheet();toast(id?'Запись обновлена':'Запись добавлена');await kb();}
 }catch(e){if(knowledgeEdit===s&&document.querySelector('#kSave')===button){error.textContent=(e.message||'Не удалось сохранить запись')+(![400,401,404,409,413].includes(e.status)?' Повтор проверит это же сохранение.':'');if([400,401,404,409,413].includes(e.status))s.attempted=null;}}
 finally{s.busy=false;fields.forEach(x=>x.disabled=false);if(knowledgeEdit===s&&document.querySelector('#kSave')===button)button.disabled=false;}
};
const editResolvedKnowledge=window.editKnowledge;
let knowledgePhotoState=null;
const knowledgePhotoBusy=()=>knowledgePhotoState?.busy||(typeof PCS!=='undefined'&&PCS.mediaBusy);
function knowledgePhotoLock(busy){knowledgePhotoState.busy=busy;if(typeof PCS!=='undefined')PCS.mediaBusy=busy}
function renderKnowledgePhotos(){
  const s=knowledgePhotoState;
  openSheet('Фото · '+s.title,`<p class="muted">До 30 фото · JPG, PNG, WEBP · до 10 МБ каждое. Файлы хранятся в закрытой базе.</p><input id="knowledgePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" multiple onchange="knowledgePhotoSelect(this.files)"><p id="knowledgePhotoQueue" class="muted">${s.files.length?esc(s.files.map(f=>f.name).join(', ')):'Выберите сразу несколько фото.'}</p><button id="knowledgePhotoUpload" class="btn" onclick="knowledgePhotoUpload()" ${s.files.length?'':'disabled'}>Загрузить выбранные</button><h3>Загружено: ${s.media.length}/30</h3><button class="btn soft" onclick="knowledgePhotoDelete()">Удалить отмеченные</button><div class="media-grid">${s.media.map(p=>`<div class="media"><label><input type="checkbox" class="knowledge-photo-selection" value="${esc(p.id)}"> Выбрать</label><img loading="lazy" decoding="async" src="${esc(p.url)}" alt="${esc(p.filename||'Фото')}"></div>`).join('')||'<p class="muted">Фотографий пока нет.</p>'}</div><button class="btn soft" onclick="knowledgeReturnToRecord('${s.id}')">Вернуться к записи</button>`);
}
window.knowledgePhotos=async function(id){
  if(knowledgeEdit?.busy)return toast('Дождитесь сохранения записи');
  if(knowledgePhotoBusy())return toast('Дождитесь окончания загрузки');
  const row=[...(window.__PCS_KB_ROWS__||[]),...KB].find(x=>String(x.id)===String(id));
  if(!row)return toast('Запись не найдена');
  try{const media=await call('/knowledge/'+id+'/media');knowledgePhotoState={id,title:row.title,media,files:[],busy:false};renderKnowledgePhotos()}catch(e){toast(e.message)}
};
window.knowledgePhotoSelect=function(files){
  if(knowledgePhotoBusy())return toast('Дождитесь окончания загрузки');
  const selected=Array.from(files);
  if(selected.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10485760))return toast('Выберите JPG, PNG или WEBP до 10 МБ');
  if(selected.length+knowledgePhotoState.media.length>30)return toast('На запись можно добавить до 30 фото');
  knowledgePhotoState.files=selected;
  document.querySelector('#knowledgePhotoQueue').textContent=selected.map(f=>f.name).join(', ');
  document.querySelector('#knowledgePhotoUpload').disabled=!selected.length;
};
window.knowledgePhotoUpload=async function(){
  if(knowledgePhotoBusy()||!knowledgePhotoState?.files.length)return;
  const s=knowledgePhotoState;knowledgePhotoLock(true);document.querySelector('#knowledgePhotoUpload').disabled=true;let done=0;
  try{
    for(const file of s.files){
      document.querySelector('#knowledgePhotoQueue').textContent=`Загрузка ${done+1} из ${s.files.length}…`;
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file)});
      await call('/knowledge/'+s.id+'/media',{method:'POST',body:JSON.stringify({filename:file.name,content_type:file.type,content_base64:data})});done++;
    }
    toast('Фотографии сохранены');
  }catch(e){toast(e.message+' — успешно загружено: '+done)}
  finally{
    s.files=s.files.slice(done);
    try{s.media=await call('/knowledge/'+s.id+'/media')}catch(e){toast('Не удалось обновить фото: '+e.message)}
    knowledgePhotoLock(false);renderKnowledgePhotos();
    const button=document.querySelector('#knowledgePhotoUpload');if(button)button.disabled=!s.files.length;
  }
};
window.knowledgePhotoDelete=async function(){
  if(knowledgePhotoBusy()||!knowledgePhotoState)return;
  const s=knowledgePhotoState,ids=Array.from(document.querySelectorAll('.knowledge-photo-selection:checked'),x=>x.value);
  if(!ids.length)return toast('Отметьте фото для удаления');
  knowledgePhotoLock(true);
  try{
    const message=`Удалить отмеченные фото (${ids.length})? Остальные останутся.`;
    const approved=window.Telegram?.WebApp?.showConfirm?await new Promise(resolve=>window.Telegram.WebApp.showConfirm(message,resolve)):confirm(message);
    if(!approved)return;
    const result=await call('/knowledge/'+s.id+'/media',{method:'DELETE',body:JSON.stringify({ids})});
    s.media=await call('/knowledge/'+s.id+'/media');toast(result?.warning||'Отмеченные фото удалены');
  }catch(e){toast(e.message)}finally{knowledgePhotoLock(false);renderKnowledgePhotos()}
};
window.knowledgeReturnToRecord=async function(id){
  if(knowledgePhotoBusy())return toast('Дождитесь окончания загрузки');
  try{const row=await call('/knowledge/'+id);if(row.id!==id||!Number.isInteger(row.revision))throw Error('Не удалось обновить запись');window.__PCS_KB_ROWS__=[row,...(window.__PCS_KB_ROWS__||[]).filter(x=>x.id!==id)];editResolvedKnowledge(id)}catch(e){toast(e.message)}
};
window.editKnowledge=function(id){
  if(knowledgeEdit?.busy)return toast('Дождитесь сохранения записи');
  const records=[...(Array.isArray(window.__PCS_KB_ROWS__)?window.__PCS_KB_ROWS__:[]),...KB];
  if(id&&!records.some(v=>String(v.id)===String(id))){
    toast('Запись не найдена. Обновите базу и повторите.');
    return;
  }
  return editResolvedKnowledge(id);
};
})();
