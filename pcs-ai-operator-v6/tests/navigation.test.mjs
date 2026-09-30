import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('all renderers keep the same bottom panel during transitions, including intermediate frames',()=>{
  const writes=[],pending=[],observers=[];
  const bottom={set innerHTML(value){writes.push(value)},get innerHTML(){return writes.at(-1)||''}};
  const root={};
  const document={body:{classList:{remove(){},add(){}}},querySelector(s){return s==='.bottom'?bottom:s==='#root'?root:null},querySelectorAll(){return []},getElementById(id){return id==='root'?root:null}};
  const window={PCS:{page:'bookings'},scrollTo(){},go(page){this.PCS.page=page;return Promise.resolve()}};
  const context=vm.createContext({window,document,localStorage:{},location:{search:''},URLSearchParams,Promise,setTimeout(fn){pending.push(fn)},requestAnimationFrame(fn){pending.push(fn);return pending.length},cancelAnimationFrame(){},MutationObserver:class{constructor(fn){observers.push(fn)}observe(){}}});
  for(const file of ['system-normalizer-v1.js','operator-ux-v37.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
  writes.length=0;
  window.pcsInstallNav25();
  for(const callback of observers)callback();
  for(let i=0;pending.length&&i<30;i++)pending.shift()();
  assert.ok(writes.length>1,'exercise intermediate renders');
  for(const html of writes){
    const labels=[...html.matchAll(/<span>([^<]+)<\/span>/g)].map(m=>m[1]);
    assert.deepEqual(labels,['Главная','Входящие','Брони','Каталог','Ещё']);
    assert.equal(html,writes.at(-1),'all renderers use identical button markup');
  }
});

test('legacy booking renderer delegates before writing a Calendar panel',()=>{
  const bottom={innerHTML:''}; let calls=0;
  const window={PCS:{page:'bookings'},pcsInstallNav25(){calls++;bottom.innerHTML='current-panel'}};
  const document={querySelector(s){return s==='.bottom'?bottom:null}};
  const context=vm.createContext({window,PCS:window.PCS,document});
  const source=readFileSync(new URL('../ops.js',import.meta.url),'utf8');
  const renderer=source.split('\n').find(line=>line.startsWith('function opsNav(){'));
  vm.runInContext(renderer+'\nopsNav();',context);
  assert.equal(calls,1);
  assert.equal(bottom.innerHTML,'current-panel');
});

