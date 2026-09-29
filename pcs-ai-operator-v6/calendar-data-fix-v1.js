(()=>{'use strict';
const original=window.opsCall;
if(typeof original!=='function')return;
window.opsCall=function(path,...args){
  const value=String(path||'');
  if(!/^\/calendar(?:\?|$)/.test(value))return original.call(this,path,...args);
  const query=value.includes('?')?value.slice(value.indexOf('?')+1):'';
  const params=new URLSearchParams(query);
  const from=params.get('from')||'',to=params.get('to')||'';
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s);
  if(!valid(from)||!valid(to)||to<from)return Promise.reject(new Error('Укажите корректный период календаря.'));
  return Promise.resolve(original.call(this,'/reservations',...args)).then(rows=>
    (Array.isArray(rows)?rows:[]).filter(row=>{
      const start=String(row?.start_date||''),end=String(row?.end_date||'');
      const status=String(row?.status||row?.operational_status||'').toLowerCase();
      return valid(start)&&valid(end)&&start<=to&&end>=from&&!['cancelled','cancelled_by_client','declined','completed'].includes(status);
    })
  );
};
})();