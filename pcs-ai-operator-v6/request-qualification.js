(()=>{'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let current;
 const alive=s=>current===s&&document.getElementById('pcsQualificationRoot')===s.root&&(!s.ticket||window.pcsSheetLifecycle.current(s.ticket));
 async function open(id){
  window.openSheet('Квалификация запроса','<div id="pcsQualificationRoot" aria-live="polite">Загружаю…</div>');
  const s=current={id,root:document.getElementById('pcsQualificationRoot'),ticket:window.pcsSheetLifecycle?.capture(),busy:false};
  try{s.data=await window.pcsManagerRequest('request-qualification',{method:'GET',params:{id}});if(!alive(s))return;render(s);}
  catch(e){if(alive(s))s.root.textContent=e.message||'Не удалось открыть квалификацию';}
 }
 function render(s){
  const d=s.data,a=d.application,prior=a.qualification||{},types=d.types;
  s.type=Object.hasOwn(types,prior.type)?prior.type:'service';s.drafts={[s.type]:{...prior.answers}};
  s.root.innerHTML=`${a.client_visible_notes?`<p style="white-space:pre-wrap;overflow-wrap:anywhere"><b>Исходный запрос:</b> ${esc(a.client_visible_notes)}</p>`:''}${a.city?`<p>Город в заявке: ${esc(a.city)}</p>`:''}<p>Ответы фиксирует оператор со слов клиента. Пустое поле означает, что вопрос ещё нужно уточнить. Цена, наличие, бронь и личность клиента этой формой не подтверждаются.</p>${!d.editable?'<p role="status">Заявка уже зафиксирована или завершена. Ответы доступны для просмотра.</p>':''}<form id="pcsQualificationForm"><label class="field">Направление<select name="type" class="input" style="width:100%;min-width:0" ${!d.editable?'disabled':''}>${Object.entries(types).map(([k,t])=>`<option value="${esc(k)}" ${k===s.type?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label><div data-answers></div><label class="field">Источник ответов (диалог / дата / комментарий)<textarea class="input" name="source_note" maxlength="1000" minlength="5" required rows="3" style="width:100%;box-sizing:border-box" ${!d.editable?'disabled':''}>${esc(prior.source_note||'')}</textarea></label><p data-progress></p><p data-feedback role="status"></p>${d.editable?'<button class="btn" type="submit">Сохранить ответы</button>':''}</form>`;
  const f=s.root.querySelector('form');s.form=f;
  const collect=()=>{s.drafts[s.type]=Object.fromEntries([...f.querySelectorAll('[data-answer]')].map(x=>[x.name,x.value]));};
  function fields(){const answers=s.drafts[s.type]||{};f.querySelector('[data-answers]').innerHTML=Object.entries(types[s.type].fields).map(([k,title])=>`<label class="field" style="display:block;margin-top:12px">${esc(title)}<input class="input" data-answer name="${esc(k)}" ${['start_date','end_date','transfer_date'].includes(k)?'type="date"':k==='transfer_time'?'type="time"':'type="text"'} maxlength="1000" value="${esc(answers[k]||'')}" style="width:100%;min-width:0;box-sizing:border-box" ${!d.editable?'disabled':''}></label>`).join('');progress();}
  function progress(){const inputs=[...f.querySelectorAll('[data-answer]')],missing=inputs.filter(x=>!x.value.trim());f.querySelector('[data-progress]').textContent=missing.length?'Ещё уточнить: '+missing.map(x=>types[s.type].fields[x.name]).join('; '):'Все поля заполнены оператором. Проверка партнёром и подтверждение клиента выполняются отдельно.';}
  f.addEventListener('input',()=>{collect();progress();});
  f.elements.type.onchange=()=>{collect();s.type=f.elements.type.value;fields();};fields();
  f.onsubmit=async e=>{e.preventDefault();if(s.busy||!alive(s)||s.form!==f||!d.editable)return;collect();s.busy=true;for(const el of f.elements)el.disabled=true;
   const feedback=f.querySelector('[data-feedback]');feedback.textContent='Сохраняю…';
   const body={id:s.id,expected_version:a.edit_version,type:s.type,answers:{...s.drafts[s.type]},source_note:f.elements.source_note.value},signature=JSON.stringify(body);
   if(s.request?.signature!==signature)s.request={signature,payload:{...body,request_id:crypto.randomUUID()}};const payload=s.request.payload;let saved=false;
   try{await window.pcsManagerRequest('request-qualification',{method:'POST',body:payload});saved=true;if(!alive(s))return;const refreshed=await window.pcsManagerRequest('request-qualification',{method:'GET',params:{id:s.id}});if(alive(s)){s.data=refreshed;render(s);}}
   catch(err){if(alive(s))feedback.textContent=(saved?'Ответы сохранены, но не удалось обновить карточку. ':'')+(err.message||'Не удалось сохранить')+' Ответы остались в форме.';}
   finally{s.busy=false;if(alive(s)&&s.form===f)for(const el of f.elements)el.disabled=false;}
  };
 }
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-pcs-qualification]');if(b)open(b.dataset.pcsQualification);});
 window.pcsQualification={open};
})();
