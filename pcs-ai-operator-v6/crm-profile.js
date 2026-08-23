(function(){
  const oldRender=window.renderClient;
  window.renderClient=function(d){
    oldRender(d);
    const c=d.contact||d;
    const box=document.querySelector('#crmDetail .info-grid');
    if(!box)return;
    const rows=[
      ['Телефон',c.phone],['Гражданство',c.nationality||c.country],['ID / Passport',c.id_or_passport],
      ['Водительские права',c.license_no],['Адрес',c.address],['Line / Telegram',c.line_contact||c.username]
    ].filter(([,v])=>v);
    if(rows.length)box.insertAdjacentHTML('beforeend',rows.map(([k,v])=>`<span>${esc(k)}</span><b>${esc(v)}</b>`).join(''));
    if(c.requested_catalog_item_id){
      const marker=document.createElement('span');marker.textContent='Запрошенный вариант';const val=document.createElement('b');val.textContent='Проверяется…';val.className='requested-item';box.append(marker,val);
      call('/catalog').then(items=>{const x=(items||[]).find(v=>v.id===c.requested_catalog_item_id);val.textContent=x?`${x.title} · ${x.status==='available'?'доступность подтверждена':x.status}`:'Вариант сохранён, но скрыт/архивирован'}).catch(()=>{val.textContent='Вариант сохранён — требуется проверка'});
    }
  };
  window.editClient=function(id){
    const c=PCS.crm.find(x=>x.id===id)||{};
    openSheet('Редактировать клиента',`
      <div class="profile-section"><h3>Основное</h3><div class="grid2">
        <div class="field"><label>Имя</label><input id="ecName" value="${esc(c.name||'')}"></div>
        <div class="field"><label>Телефон</label><input id="ecPhone" inputmode="tel" value="${esc(c.phone||'')}"></div>
        <div class="field"><label>Город</label><input id="ecCity" value="${esc(c.city||'')}"></div>
        <div class="field"><label>Гражданство</label><input id="ecNationality" value="${esc(c.nationality||c.country||'')}"></div>
      </div></div>
      <div class="profile-section"><h3>Документы для аренды</h3><div class="grid2">
        <div class="field"><label>ID / Passport</label><input id="ecPassport" autocomplete="off" value="${esc(c.id_or_passport||'')}"></div>
        <div class="field"><label>Водительские права</label><input id="ecLicense" autocomplete="off" value="${esc(c.license_no||'')}"></div>
        <div class="field"><label>Line / Telegram</label><input id="ecLine" value="${esc(c.line_contact||c.username||'')}"></div>
        <div class="field"><label>Адрес</label><input id="ecAddress" value="${esc(c.address||'')}"></div>
      </div><p class="muted">Эти данные автоматически подставляются в договор. Не заполняйте их предположениями.</p></div>
      <div class="profile-section"><h3>CRM</h3><div class="grid2">
        <div class="field"><label>Статус</label><select id="ecStatus">${['NEW','QUALIFYING','QUALIFIED','OFFER_SENT','WAITING_CLIENT','IN_PROGRESS','BOOKED','PAID','COMPLETED','LOST','SPAM'].map(v=>`<option ${c.status===v?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Приоритет</label><select id="ecPriority"><option ${c.priority!=='HOT'?'selected':''}>NORMAL</option><option ${c.priority==='HOT'?'selected':''}>HOT</option></select></div>
      </div>
      <div class="field"><label>Что нужно</label><textarea id="ecNeed">${esc(c.need||'')}</textarea></div>
      <div class="field"><label>Следующий шаг</label><textarea id="ecNext">${esc(c.next_action||'')}</textarea></div>
      ${dateTimeControl('ec',c.next_action_at)}</div>
      <button class="btn" style="width:100%;margin-top:16px" onclick="saveClient('${id}')">Сохранить</button>`);
  };
  window.saveClient=async function(id){
    try{
      const body={
        name:document.querySelector('#ecName').value.trim(),phone:document.querySelector('#ecPhone').value.trim()||null,
        city:document.querySelector('#ecCity').value.trim(),nationality:document.querySelector('#ecNationality').value.trim()||null,
        id_or_passport:document.querySelector('#ecPassport').value.trim()||null,license_no:document.querySelector('#ecLicense').value.trim()||null,
        line_contact:document.querySelector('#ecLine').value.trim()||null,address:document.querySelector('#ecAddress').value.trim()||null,
        status:document.querySelector('#ecStatus').value,priority:document.querySelector('#ecPriority').value,
        need:document.querySelector('#ecNeed').value.trim(),next_action:document.querySelector('#ecNext').value.trim(),
        next_action_at:readDateTime('ec')
      };
      await call('/crm/'+id,{method:'PATCH',body:JSON.stringify(body)});
      PCS.crm=await call('/crm');closeSheet();toast('Карточка обновлена');openClient(id,false);
    }catch(e){toast(e.message)}
  };
})();