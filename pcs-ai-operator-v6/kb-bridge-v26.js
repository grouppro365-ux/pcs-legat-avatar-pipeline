(()=>{
'use strict';
const KB='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-kb';
const prev=window.fetch.bind(window);
const token=()=>localStorage.pcsToken||'';
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:(input?.url||String(input));
  const ui='/pcs-ui-api/knowledge';
  const old='/pcs-knowledge-api';
  let suffix=null;
  const i=url.indexOf(ui),j=url.indexOf(old);
  if(i>=0)suffix=url.slice(i+ui.length);
  else if(j>=0)suffix=url.slice(j+old.length);
  if(suffix!==null){
    const h={accept:'application/json',...(init.headers||{})};
    const t=token();if(t)h.authorization='Bearer '+t;
    if(init.body!=null&&!h['content-type']&&!h['Content-Type'])h['content-type']='application/json';
    return prev(KB+(suffix||''),{...init,headers:h,cache:'no-store'});
  }
  return prev(input,init);
};
window.__PCS_KB_BRIDGE__={version:'26',endpoint:KB};
})();