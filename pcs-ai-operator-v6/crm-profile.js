(function(){
  const oldRender=window.renderClient;
  window.renderClient=function(d){
    oldRender(d);
    const c=d.contact||d;
    const box=document.querySelector('#crmDetail .info-grid');
    if(!box)return;
    const rows=[
      ['Телефон',c.phone],['WhatsApp',c.whatsapp],['LINE',c.line_contact],['Telegram',c.username?('@'+String(c.username).replace(/^@/,'')):null],
      ['Instagram',c.instagram],['Facebook',c.facebook],['Предпочтительный канал',channelRu(c.preferred_channel)],
      ['Гражданство',c.nationality||c.country],['Паспорт / ID',c.id_or_passport],['Водительские права',c.license_no],['Адрес',c.address]
    ].filter(([,v])=>v);
    if(rows.length)box.insertAdjacentHTML('beforeend',rows.map(([k,v])=>`<span>${esc(k)}</span><b>${esc(v)}</b>`).join(''));
    if(c.requested_catalog_item_id){
      const marker=document.createElement('span');marker.textContent='Запрошенный вариант';const val=document.createElement('b');val.textContent='Проверяется…';val.className='requested-item';box.append(marker,val);
      call('/catalog').then(items=>{const x=(items||[]).find(v=>v.id===c.requested_catalog_item_id);val.textContent=x?`${x.title} · ${statusRu(x.status)}`:'Вариант сохранён, но скрыт или архивирован'}).catch(()=>{val.textContent='Вариант сохранён — требуется проверка'});
    }
  };
  function channelRu(v){return ({telegram:'Telegram',whatsapp:'WhatsApp',line:'LINE',instagram:'Instagram',facebook:'Facebook',phone:'Телефон'}[v]||v||'')}
  function statusRu(v){return ({available:'доступен',checking:'проверяется',unavailable:'недоступен',archived:'архив'}[v]||v||'')}
  window.editClient=function(id){
    const c=PCS.crm.find(x=>x.id===id)||{};
    openSheet('Редактировать клиента',`
      <div class="profile-section"><h3>Основное</h3><div class="grid2">
        <div class="field"><label>Имя</label><input id="ecName" value="${esc(c.name||'')}"></div>
        <div class="field"><label>Город</label><input id="ecCity" value="${esc(c.city||'')}"></div>
        <div class="field"><label>Гражданство</label><input id="ecNationality" value="${esc(c.nationality||c.country||'')}"></div>
        <div class="field"><label>Предпочтительный канал</label><select id="ecPreferred"><option value="">Не выбран</option>${[['telegram','Telegram'],['whatsapp','WhatsApp'],['line','LINE'],['instagram','Instagram'],['facebook','Facebook'],['phone','Телефон']].map(([v,t])=>`<option value="${v}" ${c.preferred_channel===v?'selected':''}>${t}</option>`).join('')}</select></div>
      </div></div>
      <div class="profile-section"><h3>Каналы связи</h3><div class="grid2">
        <div class="field"><label>Телефон</label><input id="ecPhone" inputmode="tel" value="${esc(c.phone||'')}"></div>
        <div class="field"><label>WhatsApp</label><input id="ecWhatsapp" inputmode="tel" value="${esc(c.whatsapp||'')}"></div>
        <div class="field"><label>LINE</label><input id="ecLine" value="${esc(c.line_contact||'')}"></div>
        <div class="field"><label>Telegram</label><input id="ecTelegram" value="${esc(c.username||'')}" placeholder="username"></div>
        <div class="field"><label>Instagram</label><input id="ecInstagram" value="${esc(c.instagram||'')}" placeholder="@username"></div>
        <div class="field"><label>Facebook</label><input id="ecFacebook" value="${esc(c.facebook||'')}" placeholder="профиль или имя"></div>
      </div><p class="muted">Карточка клиента единая для всех каналов. Telegram работает сейчас; остальные каналы подготовлены для следующего этапа подключения.</p></div>
      <div class="profile-section"><h3>Документы для аренды</h3><div class="grid2">
        <div class="field"><label>Паспорт / ID</label><input id="ecPassport" autocomplete="off" value="${esc(c.id_or_passport||'')}"></div>
        <div class="field"><label>Водительские права</label><input id="ecLicense" autocomplete="off" value="${esc(c.license_no||'')}"></div>
        <div class="field"><label>Адрес</label><input id="ecAddress" value="${esc(c.address||'')}"></div>
      </div><p class="muted">Эти данные автоматически подставляются в договор. Не заполняйте их предположениями.</p></div>
      <div class="profile-section"><h3>Работа с клиентом</h3><div class="grid2">
        <div class="field"><label>Статус</label><select id="ecStatus">${['NEW','QUALIFYING','QUALIFIED','OFFER_SENT','WAITING_CLIENT','IN_PROGRESS','BOOKED','PAID','COMPLETED','LOST','SPAM'].map(v=>`<option ${c.status===v?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Приоритет</label><select id="ecPriority"><option ${c.priority!=='HOT'?'selected':''}>Обычный</option><option value="HOT" ${c.priority==='HOT'?'selected':''}>Срочный</option></select></div>
      </div>
      <div class="field"><label>Что нужно</label><textarea id="ecNeed">${esc(c.need||'')}</textarea></div>
      <div class="field"><label>Следующий шаг</label><textarea id="ecNext">${esc(c.next_action||'')}</textarea></div>
      ${dateTimeControl('ec',c.next_action_at)}</div>
      <button class="btn" style="width:100%;margin-top:16px" onclick="saveClient('${id}')">Сохранить</button>`);
  };
  window.saveClient=async function(id){
    try{
      const priority=document.querySelector('#ecPriority').value;
      const body={
        name:document.querySelector('#ecName').value.trim(),phone:document.querySelector('#ecPhone').value.trim()||null,
        whatsapp:document.querySelector('#ecWhatsapp').value.trim()||null,line_contact:document.querySelector('#ecLine').value.trim()||null,
        username:document.querySelector('#ecTelegram').value.trim().replace(/^@/,'')||null,instagram:document.querySelector('#ecInstagram').value.trim()||null,
        facebook:document.querySelector('#ecFacebook').value.trim()||null,preferred_channel:document.querySelector('#ecPreferred').value||null,
        city:document.querySelector('#ecCity').value.trim(),nationality:document.querySelector('#ecNationality').value.trim()||null,
        id_or_passport:document.querySelector('#ecPassport').value.trim()||null,license_no:document.querySelector('#ecLicense').value.trim()||null,
        address:document.querySelector('#ecAddress').value.trim()||null,status:document.querySelector('#ecStatus').value,
        priority:priority==='HOT'?'HOT':'NORMAL',need:document.querySelector('#ecNeed').value.trim(),next_action:document.querySelector('#ecNext').value.trim(),next_action_at:readDateTime('ec')
      };
      await call('/crm/'+id,{method:'PATCH',body:JSON.stringify(body)});
      PCS.crm=await call('/crm');closeSheet();toast('Карточка обновлена');openClient(id,false);
    }catch(e){toast(e.message)}
  };
})();