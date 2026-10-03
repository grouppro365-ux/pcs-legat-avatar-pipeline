(() => {
 'use strict';
 const ENDPOINT='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-contract-files';
 const ACCEPT=['image/jpeg','image/png','image/webp'];
 const LIMIT=15*1024*1024;
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let current=null;
 const messages={unauthorized:'Сессия истекла. Войдите снова.',unsupported_file_type:'Используйте JPG, PNG или WEBP.',file_too_large:'Фото больше 15 МБ.',file_required:'Выберите фото документа.',invalid_base64:'Не удалось прочитать фото. Выберите файл повторно.',no_supported_images:'Сначала загрузите фото паспорта или прав.',vision_provider_not_configured:'OpenRouter не настроен.',vision_credit_limit:'Недостаточно средств или достигнут лимит ключа OpenRouter.',vision_request_failed:'OpenRouter не смог распознать фото. Повторите попытку.',vision_invalid_response:'Ответ распознавания не удалось прочитать. Повторите попытку.',too_many_images:'Выберите не больше 8 фото для распознавания.',ocr_payload_too_large:'Выбранные фото слишком большие для одного распознавания. Выберите меньше снимков.',document_not_found:'Одно из фото больше недоступно. Обновите список.'};
 async function request(body,rid) {
  const options={headers:{authorization:'Bearer '+(localStorage.pcsToken||''),'content-type':'application/json'},cache:'no-store'};
  if(body){options.method='POST';options.body=JSON.stringify(body)}
  const response=await fetch(ENDPOINT+(body?'':'?reservation_id='+encodeURIComponent(rid)),options);
  let result={};try{result=await response.json()}catch{}
  if(!response.ok)throw Error(messages[result.error]||'Не удалось обработать документы ('+response.status+').');
  return result;
 }
 function active(state){return current===state&&document.getElementById('ctDocuments')?.dataset.reservation===state.rid}
 function status(state,message){if(active(state))document.getElementById('ctDocumentStatus').textContent=message}
 function busy(state,value){state.busy=value;if(active(state))document.querySelectorAll('#ctDocuments button,#ctDocuments input').forEach(el=>el.disabled=value||el.dataset.ocrUnsupported==='true'||(state.locked&&el.id==='ctDocumentRecognize'))}
 function checked(state){return [...document.querySelectorAll('#ctDocumentList input:checked')].map(input=>input.value)}
 async function refresh(state){
  const files=await request(null,state.rid);if(!active(state))return;
  state.files=Array.isArray(files)?files:[];
  document.getElementById('ctDocumentList').innerHTML=state.files.map((file,index)=>`<label class="ct-document-item" title="${E(file.name)}"><input type="checkbox" value="${E(file.name)}" ${index<8&&/\.(jpe?g|png|webp)$/i.test(file.name)?'checked':''} ${/\.(jpe?g|png|webp)$/i.test(file.name)?'':'disabled data-ocr-unsupported="true"'}><span>${E((/-passport-/i.test(file.name)?"Паспорт":/-license-/i.test(file.name)?"Водительские права":"Документ")+" · фото "+(index+1))}</span>${file.url?`<a href="${E(file.url)}" target="_blank" rel="noopener noreferrer">Открыть</a>`:''}</label>`).join('')||'<p class="muted">Фото ещё не загружены.</p>';
 }
 function render(rid){return `<section id="ctDocuments" data-reservation="${E(rid)}" class="card"><h3>Фото документов</h3><div class="grid2"><div class="field"><label for="ctPassportPhotos">Паспорт / ID — фото страниц</label><input id="ctPassportPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><button type="button" class="btn ghost" onclick="pcsContractDocuments.upload('passport')">Загрузить паспорт</button></div><div class="field"><label for="ctLicensePhotos">Водительские права — обе стороны</label><input id="ctLicensePhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><button type="button" class="btn ghost" onclick="pcsContractDocuments.upload('license')">Загрузить права</button></div></div><p class="muted">JPG, PNG, WEBP · до 15 МБ на фото. Документы хранятся приватно. Для распознавания отметьте до 8 снимков.</p><div id="ctDocumentList">Загружаю список…</div><p id="ctDocumentStatus" role="status" aria-live="polite"></p><p class="muted">Только после подтверждения выбранные фото будут отправлены в OpenRouter. Сверьте распознанные данные с оригиналами перед сохранением.</p><button id="ctDocumentRecognize" type="button" class="btn soft" onclick="pcsContractDocuments.recognize()">Распознать через OpenRouter</button></section>`}
 async function mount(contract){
  const state={id:contract.id,rid:contract.reservation_id,locked:['ready_to_sign','signed','superseded','cancelled'].includes(contract.status),busy:false,files:[]};current=state;
  if(!state.rid)return;
  try{await refresh(state);busy(state,false);if(state.locked)status(state,'Версия зафиксирована. Фото можно прикреплять и просматривать; распознавание полей доступно в черновике.')}catch(error){status(state,error.message)}
 }
 async function upload(kind){
  const state=current;if(!state||state.busy||!active(state))return;
  const input=document.getElementById(kind==='passport'?'ctPassportPhotos':'ctLicensePhotos');
  const files=[...(input?.files||[])];
  if(!files.length)return status(state,'Выберите фото '+(kind==='passport'?'паспорта.':'прав.'));
  const invalid=files.find(file=>!ACCEPT.includes(file.type)||file.size===0||file.size>LIMIT);
  if(invalid)return status(state,!ACCEPT.includes(invalid.type)?'«'+invalid.name+'»: используйте JPG, PNG или WEBP.':invalid.size===0?'Выбран пустой файл.':'«'+invalid.name+'»: фото больше 15 МБ.');
  busy(state,true);let saved=0;
  try{
   for(const file of files){
    status(state,'Загрузка '+(saved+1)+' из '+files.length+'…');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Не удалось прочитать фото.'));reader.readAsDataURL(file)});
    await request({kind:'client_document',reservation_id:state.rid,filename:kind+'-'+file.name,mime:file.type,base64});saved++;
   }
   if(active(state))input.value='';
   await refresh(state);status(state,'Сохранено фото: '+saved+(state.locked?'. Поля зафиксированной версии не меняются.':'. Можно распознать выбранные документы.'));
  }catch(error){
   if(saved)await refresh(state).catch(()=>{});
   status(state,(saved?'Сохранено фото: '+saved+'. ':'')+error.message);
  }finally{busy(state,false)}
 }
 async function recognize(){
  const state=current;if(!state||state.busy||!active(state))return;
  if(state.locked)return status(state,'Версия зафиксирована. Распознавание полей доступно в черновике.');
  const filenames=checked(state);if(!filenames.length)return status(state,'Сначала загрузите и отметьте фото документов.');
  if(filenames.length>8)return status(state,messages.too_many_images);
  if(!window.confirm('Отправить выбранные фото документов ('+filenames.length+') в OpenRouter для распознавания?'))return;
  busy(state,true);status(state,'OpenRouter распознаёт выбранные документы…');
  try{
   const result=await request({kind:'ocr_documents',reservation_id:state.rid,filenames});if(!active(state))return;
   const fields=result.fields||{};
   const mapping={ctName:fields.full_name,ctPassport:fields.passport_number,ctNationality:fields.nationality,ctLicense:fields.driving_license_number};
   let filled=0;for(const [key,value] of Object.entries(mapping)){const input=document.getElementById(key);if(input&&!input.value.trim()&&typeof value==='string'&&value.trim()){input.value=value.trim();filled++}}
   status(state,filled?'Заполнено полей: '+filled+'. Сверьте данные с фото и нажмите «Сохранить».':'Новых полей не заполнено: имеющиеся данные сохранены. Нечитаемые значения заполните вручную.');
  }catch(error){status(state,error.message)}finally{busy(state,false)}
 }
 window.pcsContractDocuments={render,mount,upload,recognize};
})();
