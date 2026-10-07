import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function harness(){
  const nodes={pcsApCatalogList37:{innerHTML:''},pcsApServices:{innerHTML:''}};
  const sheets=[];
  const item={id:'11111111-1111-4111-8111-111111111111',title:'MG5',city:'Pattaya',price:660};
  const window={PCS:{catalog:[item]},PCS_EXTRAS37:[{...item,name:'MG5'}],go(){},
    call:async()=>({item:{...item,revision:{ui:{description:'Existing description'}}},media:[]})};
  const document={getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],querySelector:()=>null,body:{}};
  vm.runInNewContext(readFileSync(new URL('../operator-ux-v37.js',import.meta.url),'utf8'),
    {window,document,localStorage:{},location:{search:''},URLSearchParams,MutationObserver:class{observe(){}},
      setTimeout(){},requestAnimationFrame(){},cancelAnimationFrame(){},
      call:(...args)=>window.call(...args),openSheet:(title,body)=>sheets.push({title,body}),toast(){},console});
  return {window,nodes,sheets,item};
}
test('catalog and existing service rows expose editing the selected id and photos',async()=>{
  const h=harness();h.window.pcsCatalogFilter37('all');h.window.pcsExtraFilter37('all');
  assert.match(h.nodes.pcsApCatalogList37.innerHTML,/editCatalog37\('11111111/);
  assert.match(h.nodes.pcsApCatalogList37.innerHTML,/mediaManager\('11111111/);
  assert.match(h.nodes.pcsApServices.innerHTML,/editCatalog37\('11111111/);
  assert.doesNotMatch(h.nodes.pcsApServices.innerHTML,/newExtra\(\)/);
  await h.window.editCatalog37(h.item.id);
  assert.match(h.sheets[0].title,/Редактировать/);
  assert.match(h.sheets[0].body,/MG5/);assert.match(h.sheets[0].body,/Existing description/);
});
test('saving an edit immediately updates the existing card description without losing its tariff',async()=>{
 const h=harness();
 for(const [key,value]of Object.entries({catalogEditVersion37:'2026-10-07 13:00:00.123456+00',catalogEditTitle37:'MG5 updated',catalogEditCity37:'Pattaya',catalogEditDescription37:'New description',catalogEditConditions37:'New conditions'}))h.nodes[key]={value};
 h.window.call=async()=>({ok:true,item:{...h.item,title:'MG5 updated'}});
 await h.window.saveCatalog37(h.item.id,{disabled:false});
 assert.equal(h.item.description,'New description');assert.equal(h.item.price,660);
 assert.equal(h.window.PCS_EXTRAS37[0].description,'New description');
 assert.match(h.nodes.pcsApCatalogList37.innerHTML,/New description/);
});

test('catalog conflict retains entered draft and the captured original version',async()=>{
 const h=harness();const version='2026-10-07 13:00:00.123456+00';
 for(const [key,value]of Object.entries({catalogEditVersion37:version,catalogEditTitle37:'Draft title',catalogEditCity37:'Pattaya',catalogEditDescription37:'Draft text',catalogEditConditions37:'Draft terms'}))h.nodes[key]={value};
 let request;h.window.call=async(path,init)=>{request=JSON.parse(init.body);throw Error('Карточка уже изменена');};
 const button={disabled:false};await h.window.saveCatalog37(h.item.id,button);
 assert.equal(request.expected_version,version);assert.equal(h.nodes.catalogEditDescription37.value,'Draft text');assert.equal(h.nodes.catalogEditVersion37.value,version);assert.equal(button.disabled,false);assert.equal(h.item.title,'MG5');
});
