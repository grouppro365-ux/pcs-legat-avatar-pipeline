(()=>{
  const physicalFleetCount=(rows=[])=>{
    const ids=new Set();
    for(const x of rows){
      if(x?.deleted_at||x?.ownership_type!=='pcs_owned'||!String(x?.category||'').startsWith('car_'))continue;
      const m=x.metadata||{};
      if(m.fleet_master===true){
        const id=m.ltc_id||m.fleet_id||x.title;
        if(id)ids.add(String(id));
      }
    }
    return ids.size;
  };
  function patchCatalog(){
    const rows=window.PCS?.catalog||[];
    const n=physicalFleetCount(rows);
    if(!n)return;
    document.querySelectorAll('.premium-kpi').forEach(card=>{
      const label=card.querySelector('span');
      if(!label)return;
      const t=(label.textContent||'').trim();
      if(t==='Автомобили'||t==='Автопарк'){
        label.textContent='Автопарк';
        const b=card.querySelector('b');if(b)b.textContent=String(n);
      }
    });
  }
  function patchDashboard(){
    const rows=window.PCS?.catalog||[];
    const n=physicalFleetCount(rows);
    if(!n)return;
    document.querySelectorAll('.travel-shortcut').forEach(btn=>{
      const label=btn.querySelector('span:last-child');
      if(label&&(label.textContent||'').trim()==='Автопарк')btn.setAttribute('aria-label',`Автопарк — ${n} машин`);
    });
  }
  function apply(){patchCatalog();patchDashboard()}
  let raf=0;
  new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);
  setTimeout(apply,0);setTimeout(apply,800);setTimeout(apply,2200);
  window.addEventListener('pcs:catalog-loaded',apply);
})();
