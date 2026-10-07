(()=>{'use strict';
const key='pcs.catalog.createDraft.v1',uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const categories={service:'Услуга',car_rent:'Аренда автомобиля',car_sale:'Продажа автомобиля',housing_rent:'Аренда жилья',housing_sale:'Продажа недвижимости',transfer:'Трансфер',visa:'Визы и документы',medicine:'Медицина',cleaning:'Клининг'};
const fields={title:['Название',500],city:['Город',200],description:['Описание',20000],conditions:['Условия',10000],source:['Источник информации',2000],client_price_thb:['Цена, THB',30],deposit_thb:['Депозит, THB',30]};
let state;
function node(k){return document.getElementById('catalogNew_'+k)}
function store(body){sessionStorage.setItem(key,JSON.stringify(body));}
function restored(){try{const b=JSON.parse(sessionStorage.getItem(key)||'null');if(b&&uuid.test(b.request_id)&&typeof b.title==='string'&&b.title.length<=500&&categories[b.category])return b;}catch{}return null;}
function lock(s,on){for(const k of [...Object.keys(fields),'category']){const e=node(k);if(e)e.disabled=on;}if(node('save'))node('save').disabled=s.busy;}
function read(s){const b={request_id:s.id,category:node('category').value};if(!categories[b.category])throw Error('Выберите категорию');b.entity_type=b.category.startsWith('car_')?'VEHICLE':b.category.startsWith('housing_')?'PROPERTY':'SERVICE';
 for(const [k,[label,max]] of Object.entries(fields)){let value=node(k).value.trim();if(value.length>max)throw Error('Слишком длинное поле: '+label);if(k.endsWith('_thb')){value=value.replace(',','.');if(value&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))throw Error('Укажите сумму до двух знаков после запятой: '+label);b[k]=value||null;}else b[k]=value;}
 if(!b.title)throw Error('Укажите название');return b;
}
function open(){if(state?.busy)return;const body=restored();state={id:body?.request_id||crypto.randomUUID(),body,busy:false,saved:false};
 const inputs=Object.entries(fields).map(([k,[label,max]])=>`<div class="field"><label for="catalogNew_${k}">${label}</label>${['description','conditions'].includes(k)?`<textarea id="catalogNew_${k}" rows="${k==='description'?4:3}" maxlength="${max}">${esc(body?.[k])}</textarea>`:`<input id="catalogNew_${k}" maxlength="${max}" ${k.endsWith('_thb')?'inputmode="decimal"':''} value="${esc(body?.[k])}">`}</div>`).join('');
 openSheet('Новая карточка',`<div id="catalogNew_form" class="pcs-catalog-create"><p class="muted">Карточка сохранится как черновик. Фото можно добавить после сохранения.</p><div class="field"><label for="catalogNew_category">Категория</label><select id="catalogNew_category">${Object.entries(categories).map(([k,v])=>`<option value="${k}" ${body?.category===k?'selected':''}>${v}</option>`).join('')}</select></div>${inputs}<p id="catalogNew_error" class="pcs-create-error" role="alert" aria-live="polite"></p><button id="catalogNew_save" class="btn" type="button">${body?'Повторить сохранение':'Сохранить черновик'}</button></div>`);
 state.form=node('form');node('save').onclick=save;lock(state,!!body);
 if(body)node('error').textContent='Сохранение ранее не было подтверждено. Повторите его — новая карточка не продублируется.';
}
async function save(){const s=state;if(!s||s.saved||s.busy||s.form!==node('form'))return;
 try{if(!s.body){const body=read(s);store(body);s.body=body;}s.busy=true;node('error').textContent='';lock(s,true);
 const result=await call('/catalog',{method:'POST',body:JSON.stringify(s.body)});
 if(!result?.ok||String(result.id).toLowerCase()!==s.id.toLowerCase()||result.version!==1)throw Error('Сервер не подтвердил сохранение');
 s.saved=true;try{sessionStorage.removeItem(key);}catch{}
 if(state===s&&s.form===node('form')){node('error').textContent='Черновик сохранён. Он доступен в каталоге.';node('save').textContent='Открыть карточку';node('save').onclick=()=>{closeSheet();editCatalog37(result.id);};}
 try{const rows=await call('/catalog');if(!Array.isArray(rows))throw Error('Некорректный список');if(window.PCS)window.PCS.catalog=rows;window.pcsCatalogFilter37?.('all');}catch{if(state===s&&s.form===node('form'))node('error').textContent='Черновик сохранён. Список не обновился; карточку можно открыть кнопкой ниже.';}
 }catch(e){if(state===s&&s.form===node('form')){node('error').textContent=(e.message||'Не удалось подтвердить сохранение')+(s.body?' Повторите сохранение с теми же данными.':'');node('save').textContent=s.body?'Повторить сохранение':'Сохранить черновик';}}
 finally{s.busy=false;if(state===s&&s.form===node('form'))lock(s,!!s.body);}
}
window.pcsCatalogCreate={open};
})();
