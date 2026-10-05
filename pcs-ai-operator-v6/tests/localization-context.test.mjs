import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('explicit contextual labels survive global option-value localization while booking statuses still translate',()=>{
 const make=marked=>({tagName:'OPTION',value:'active',textContent:marked?'Незавершённые заявки':'active',childNodes:[{nodeType:3,nodeValue:marked?'Незавершённые заявки':'active'}],closest:selector=>marked&&selector.includes('[data-pcs-localized]')?{}:null,hasAttribute:()=>false});
 const contextual=make(true),booking=make(false),document={documentElement:{},querySelectorAll:()=>[contextual,booking]},window={addEventListener:(event,fn)=>fn()};
 vm.runInNewContext(readFileSync(new URL('../localization.js',import.meta.url),'utf8'),{window,document,Node:{TEXT_NODE:3},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),setTimeout:()=>{}});
 assert.equal(contextual.textContent,'Незавершённые заявки');assert.equal(booking.textContent,'В аренде');
});
