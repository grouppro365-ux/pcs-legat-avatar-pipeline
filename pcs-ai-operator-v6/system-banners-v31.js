(()=>{
'use strict';
function wrap(root,selector,items,brand=false){
  if(!root||root.querySelector('.'+selector))return;
  const nodes=items.map(s=>root.querySelector(s)).filter(Boolean);
  if(!nodes.length)return;
  const hero=document.createElement('section');hero.className=selector;
  if(brand){const b=document.createElement('div');b.className='pcs-system-brand';b.textContent='PCS Concierge';hero.appendChild(b)}
  nodes[0].before(hero);nodes.forEach(n=>hero.appendChild(n));
}
function enhance(){
  wrap(document.querySelector('.in25-work'),'in25-hero',['.in25-kicker','.in25-title','.in25-sub'],true);
  wrap(document.querySelector('.cal25-work'),'cal25-hero',['.cal25-kicker','.cal25-title','.cal25-sub']);
  wrap(document.querySelector('.cx25-work'),'cx25-hero',['.cx25-kicker','.cx25-title','.cx25-sub']);
  if(window.PCS?.page==='status')wrap(document.querySelector('#main'),'v24-hero',[':scope>.eyebrow',':scope>.title',':scope>.sub']);
  if(window.PCS?.page==='kb')wrap(document.querySelector('.v26-page'),'v26-hero',[':scope>.v26-kicker',':scope>.v26-head']);
  const m=document.querySelector('#main');
  if(m&&!document.body.classList.contains('pcs-approved-page')&&!m.querySelector('.ops-system-hero')){
    const eye=m.querySelector(':scope>.eyebrow'),title=m.querySelector(':scope>.title'),sub=m.querySelector(':scope>.sub');
    if(eye&&title&&sub)wrap(m,'ops-system-hero',[':scope>.eyebrow',':scope>.title',':scope>.sub']);
  }
}
let queued=false;
new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}).observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('DOMContentLoaded',enhance);enhance();
})();
