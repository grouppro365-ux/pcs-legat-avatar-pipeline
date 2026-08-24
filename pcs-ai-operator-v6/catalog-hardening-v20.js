(()=>{
  const CAT_LABEL={car_rent:'Аренда авто',car_buy:'Продажа авто'};
  let fleetMode=false;
  let bindRaf=0,applyRaf=0;

  function esc(s=''){
    return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function css(){
    if(document.querySelector('#pcsCatalogHardeningV20Css'))return;
    const s=document.createElement('style');
    s.id='pcsCatalogHardeningV20Css';
    s.textContent=`
      .pcs-v20-blocker{margin-top:10px;padding:10px 12px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.10);border-radius:14px;font-size:12px;line-height:1.35;color:var(--text,#1f2937)}
      .pcs-v20-blocker b{display:block;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#92400e}
      .pcs-v20-blocker small{display:block;margin-top:4px;opacity:.72}
    `;
    document.head.appendChild(s);
  }

  function fleetKey(x){
    const m=x?.metadata||{};
    return String(m.ltc_id||m.fleet_id||x?.title||'').trim();
  }

  function fleetRows(rows=[]){
    const best=new Map();
    for(const x of rows){
      if(x?.deleted_at||x?.ownership_type!=='pcs_owned'||!String(x?.category||'').startsWith('car_')||x?.metadata?.fleet_master!==true)continue;
      const key=fleetKey(x);if(!key)continue;
      const score=(x.category==='car_rent'?4:0)+(x.status==='available'?2:0)+(Number(x.daily_price||0)>0?1:0);
      const old=best.get(key);
      if(!old||score>old.score)best.set(key,{row:x,score});
    }
    return [...best.values()].map(v=>v.row);
  }

  function cardRow(card,rows){
    const title=(card.querySelector('h3')?.textContent||'').trim();
    const text=card.textContent||'';
    const exact=rows.filter(x=>String(x.title||'').trim()===title);
    if(exact.length<=1)return exact[0]||null;
    return exact.find(x=>text.includes(CAT_LABEL[x.category]||x.category||''))||exact[0]||null;
  }

  function blocker(row){
    const s=row?.metadata?.ltc_master_snapshot;
    if(!s)return null;
    if(s.publication_allowed===true&&s.card_ready===true)return null;
    return {
      blocker:String(s.blocker||row.pricing_note||row.availability_note||'требуется проверка источников').trim(),
      source:String(s.source||'LTC master').trim(),
      checked:String(s.checked_at||row.last_checked_at||'').trim(),
      cardReady:s.card_ready===true,
      publicationAllowed:s.publication_allowed===true
    };
  }

  function decorateBlockers(rows){
    css();
    document.querySelectorAll('#cat .catalog-card').forEach(card=>{
      const row=cardRow(card,rows);
      const b=blocker(row);
      let box=card.querySelector('.pcs-v20-blocker');
      if(!b){box?.remove();return;}
      const html=`<b>Не готово к публикации без проверки</b>${esc(b.blocker)}<small>${esc(b.source)}${b.checked?' · проверка '+esc(b.checked):''}</small>`;
      if(!box){box=document.createElement('div');box.className='pcs-v20-blocker';card.appendChild(box);}
      if(box.innerHTML!==html)box.innerHTML=html;
    });
  }

  function applyFleet(){
    if(!fleetMode)return;
    const all=window.PCS?.catalog||[];
    const chosen=fleetRows(all);
    const ids=new Set(chosen.map(x=>x.id));
    const cards=[...document.querySelectorAll('#cat .catalog-card')];
    let visible=0;
    for(const card of cards){
      const row=cardRow(card,all);
      const show=!!row&&ids.has(row.id);
      if(card.hidden===show)card.hidden=!show;
      if(show)visible++;
    }
    decorateBlockers(all);
    const oldEmpty=document.querySelector('#fleetEmptyV20');
    if(cards.length&&!visible){
      if(!oldEmpty){
        const empty=document.createElement('div');
        empty.id='fleetEmptyV20';empty.className='empty';empty.textContent='В физическом автопарке нет позиций с выбранным статусом';
        document.querySelector('#cat')?.appendChild(empty);
      }
    }else oldEmpty?.remove();
    const b=document.querySelector('#fleetKpi [data-kpi-cat="cars"]');
    if(b){b.classList.add('on');if(b.getAttribute('aria-pressed')!=='true')b.setAttribute('aria-pressed','true')}
  }

  function schedule(){cancelAnimationFrame(applyRaf);applyRaf=requestAnimationFrame(applyFleet)}

  function bind(){
    const root=document.querySelector('#fleetKpi');
    if(!root)return;
    const all=window.PCS?.catalog||[];
    const fleet=fleetRows(all);
    decorateBlockers(all);
    const fleetBtn=root.querySelector('[data-kpi-cat="cars"]');
    if(fleetBtn){
      const label=fleetBtn.querySelector('span');if(label&&label.textContent!=='Автопарк')label.textContent='Автопарк';
      const count=fleetBtn.querySelector('b'),next=String(fleet.length);if(count&&count.textContent!==next)count.textContent=next;
      if(!fleetBtn.dataset.v20Bound){
        fleetBtn.dataset.v20Bound='1';
        fleetBtn.title='Показать физические машины автопарка без дублей объявлений';
        fleetBtn.setAttribute('aria-pressed','false');
        fleetBtn.addEventListener('click',()=>{fleetMode=true;setTimeout(schedule,0)});
      }
    }
    root.querySelectorAll('[data-kpi-status]').forEach((b,i)=>{
      if(b.dataset.v20Bound)return;b.dataset.v20Bound='1';
      b.addEventListener('click',()=>{
        if(i===0){fleetMode=false;fleetBtn?.classList.remove('on');fleetBtn?.setAttribute('aria-pressed','false')}
        else if(fleetMode)setTimeout(schedule,0);
      });
    });
    document.querySelectorAll('#fleetFilters [data-fleet-filter]').forEach(b=>{
      if(b.dataset.v20Bound)return;b.dataset.v20Bound='1';
      b.addEventListener('click',()=>{fleetMode=false;fleetBtn?.classList.remove('on');fleetBtn?.setAttribute('aria-pressed','false');document.querySelector('#fleetEmptyV20')?.remove()});
    });
    document.querySelectorAll('#statusFilters [data-status-filter]').forEach(b=>{
      if(b.dataset.v20Bound)return;b.dataset.v20Bound='1';
      b.addEventListener('click',()=>{if(fleetMode)setTimeout(schedule,0)});
    });
    if(fleetMode)schedule();
  }

  new MutationObserver(()=>{cancelAnimationFrame(bindRaf);bindRaf=requestAnimationFrame(bind)}).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',bind);setTimeout(bind,0);
  window.PCSPhysicalFleet={rows:fleetRows,blocker,get active(){return fleetMode}};
})();
