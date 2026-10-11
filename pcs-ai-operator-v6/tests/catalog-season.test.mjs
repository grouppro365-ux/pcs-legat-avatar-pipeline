import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function harness(){
 const nodes={'#seasonFrom':{value:'2026.10.01'},'#seasonTo':{value:'2027.04.30'},'#seasonMult':{value:'1.9'},'#seasonName':{value:'Высокий сезон'},'#catalogSeasonSave':{disabled:false,textContent:'Добавить сезон'},'#catalogSeasonResult':{textContent:''}},calls=[];let resolve,reject;
 const window={pricingManager:async()=>{}};
 const context={window,PCS:{catalog:[]},document:{querySelector:q=>nodes[q]},toast:()=>{},catalog:async()=>{},call:async()=>[],adminCall:b=>{calls.push(b);return new Promise((a,z)=>{resolve=a;reject=z})}};
 vm.runInNewContext(readFileSync(new URL('../catalog-safety.js',import.meta.url),'utf8'),context);
 return {window,context,nodes,calls,resolve:value=>resolve(value||{ok:true,rule:{id:'rule'}}),reject:()=>reject(Error('Некорректный диапазон дат'))};
}
test('season click shows progress, prevents duplicate submits and displays errors inside the open sheet',async()=>{
 const h=harness(),p=h.window.addSeasonRule('catalog');await h.window.addSeasonRule('catalog');assert.equal(h.calls.length,1);assert.equal(h.calls[0].date_from,'2026.10.01');assert.equal(h.calls[0].multiplier,1.9);
 assert.equal(h.nodes['#catalogSeasonSave'].disabled,true);assert.match(h.nodes['#catalogSeasonResult'].textContent,/Сохраняем/);
 h.reject();await p;assert.match(h.nodes['#catalogSeasonResult'].textContent,/диапазон/);assert.equal(h.nodes['#seasonFrom'].value,'2026.10.01');assert.equal(h.nodes['#catalogSeasonSave'].disabled,false);
});
test('confirmed season remains saved when catalogue refresh fails, with visible feedback and no repeat',async()=>{
 const h=harness();h.context.call=async()=>{throw Error('refresh')};const p=h.window.addSeasonRule('catalog');h.resolve();await p;
 assert.match(h.nodes['#catalogSeasonResult'].textContent,/сохранён/);await h.window.addSeasonRule('catalog');assert.equal(h.calls.length,1);assert.equal(h.nodes['#catalogSeasonSave'].disabled,true);
});
test('unconfirmed response and errors from an old sheet cannot overwrite a new sheet',async()=>{
 const h=harness();const p=h.window.addSeasonRule('catalog');h.resolve({ok:false});await p;assert.match(h.nodes['#catalogSeasonResult'].textContent,/не подтвердил/);
 const p2=h.window.addSeasonRule('catalog');h.nodes['#seasonFrom']={value:'another form'};h.nodes['#catalogSeasonResult']={textContent:'new form'};h.reject();await p2;assert.equal(h.nodes['#catalogSeasonResult'].textContent,'new form');
});
