import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../pcs-ai-operator-v6/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function fixture(){
 const elements=new Map();
 class El{constructor(id){this.id=id;this.value='';this.isConnected=true;this.dataset={};this.classList={add(){},remove(){},contains(){return false}}}set innerHTML(html){this.html=html;if(this.id==='root'){for(const [id,el] of elements)if(id!=='root')el.isConnected=false;for(const id of [...elements.keys()])if(id!=='root')elements.delete(id)}for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,new El(id))}get innerHTML(){return this.html||''}closest(){return null}querySelector(){return null}querySelectorAll(){return []}}
 elements.set('root',new El('root'));
 const document={getElementById:id=>elements.get(id)||null,querySelector:q=>q.startsWith('#')&&!q.includes(' ')?elements.get(q.slice(1))||null:null,body:{classList:{add(){},remove(){},contains(){return false}}}};
 const c=vm.createContext({document,console,localStorage:{pcsToken:'fixture'},Promise,Intl,Date,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>[]})});c.window=c;c.PCS={page:'dashboard'};c.call=async()=>({});c.go=()=>{};c.shell=()=>'<main id="main"></main>';c.esc=String;c.scrollTo=()=>{};c.toast=()=>{};c.closeSheet=()=>{};c.openSheet=()=>{};
 vm.runInContext(source('navigation-lifecycle.js'),c);vm.runInContext(source('sheet-lifecycle.js'),c);
 const mount=()=>document.getElementById('root').innerHTML=c.shell();
 return {c,document,mount};
}
test('status response and rejection after leaving do not touch the next page',async()=>{
 for(const reject of [false,true]){
  const {c,document,mount}=fixture();vm.runInContext(source('status-v24.js'),c);let done;const waiting=new Promise((resolve,rejectFn)=>{done=reject?()=>rejectFn(Error('offline')):()=>resolve({contacts:9})});c.call=()=>waiting;
  const old=c.pcsNavigation.run('status',()=>c.pcsStatus24());c.pcsNavigation.run('inbox',mount);done();await old;assert.equal(c.PCS.page,'inbox');assert.equal(document.querySelector('#v24Status'),null);
 }
});
test('return to errors while an old request is pending loads a fresh queue',async()=>{
 const {c,document,mount}=fixture();vm.runInContext(source('errors.js'),c);const old=deferred(),fresh=deferred();let calls=0;c.fetch=()=>++calls===1?old.promise:fresh.promise;
 mount();const first=c.pcsNavigation.run('errors',()=>c.errorsPage('runtime',0));c.pcsNavigation.run('inbox',mount);const last=c.pcsNavigation.run('errors',()=>{mount();return c.errorsPage('delivery',0)});
 assert.equal(calls,2);fresh.resolve({ok:true,json:async()=>({source:'delivery',rows:[]})});await last;const html=document.querySelector('#errList').innerHTML;assert.match(html,/Записей в этой очереди нет/);old.resolve({ok:true,json:async()=>({source:'runtime',rows:[{error:'stale',status:'failed'}]})});await first;assert.equal(document.querySelector('#errList').innerHTML,html);
});
test('connections renders wait for loading and ignore older settings on same-page revisit',async()=>{
 const {c,document,mount}=fixture();vm.runInContext(source('connections-v25.js'),c);const old=deferred(),fresh=deferred();let calls=0;c.call=()=>++calls===1?old.promise:fresh.promise;
 const first=c.pcsNavigation.run('connect',()=>c.pcsConnections25());c.pcsNavigation.run('inbox',mount);const latest=c.pcsNavigation.run('connect',()=>c.pcsConnections25());assert.equal(typeof latest?.then,'function');fresh.resolve({configured:{telegram_bot_token:true}});await latest;assert.equal(document.getElementById('cx25TelegramStatus').textContent,'Токен сохранён');old.resolve({configured:{telegram_bot_token:false}});await first;assert.equal(document.getElementById('cx25TelegramStatus').textContent,'Токен сохранён');
});
test('delayed BotHelp setup cannot open a sheet after navigation',async()=>{
 const {c,mount}=fixture();vm.runInContext(source('connections-v25.js'),c);await c.pcsNavigation.run('connect',()=>c.pcsConnections25());const pending=deferred();c.fetch=()=>pending.promise;let opened=0;c.openSheet=()=>opened++;
 const action=c.pcsBotHelpSetup25();c.pcsNavigation.run('inbox',mount);pending.resolve({ok:true,json:async()=>({configured:{}})});await action;assert.equal(opened,0);
});
test('saving connection settings cannot close a replacement sheet',async()=>{
 const {c,document}=fixture();vm.runInContext(source('connections-v25.js'),c);await c.pcsNavigation.run('connect',()=>c.pcsConnections25());const pending=deferred();c.call=()=>pending.promise;let closed=0;c.closeSheet=()=>closed++;
 // The production openSheet creates these fields synchronously.
 document.getElementById('root').innerHTML='<div id="cx25Channels"></div><input id="cxTrModel"><input id="cxOrModel"><input id="cxTrKey"><input id="cxOrKey">';
 const action=c.pcsAiSave25();c.pcsSheetLifecycle.invalidate();pending.resolve({});await action;assert.equal(closed,0);
});
