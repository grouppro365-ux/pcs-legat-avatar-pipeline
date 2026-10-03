import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../theme-controller.js',import.meta.url),'utf8');
function setup(saved, dark=false, blocked=false) {
 const events={},changes={},data={pcsTheme:saved},root={dataset:{},style:{}};
 const media={matches:dark,addEventListener:(name,fn)=>changes[name]=fn};
 const window={addEventListener:(name,fn)=>events[name]=fn};
 const document={documentElement:root,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}};
 vm.runInNewContext(source,{window,document,matchMedia:()=>media,localStorage:{getItem:key=>{if(blocked)throw Error();return data[key]},setItem:(key,value)=>{if(blocked)throw Error();data[key]=value}}});
 return {root,window,media,changes,events,data};
}
test('system follows device changes',()=>{const s=setup(null);assert.equal(s.root.dataset.theme,'light');s.media.matches=true;s.changes.change();assert.equal(s.root.dataset.theme,'dark');assert.equal(s.root.dataset.themePreference,'system')});
test('explicit preference survives device changes',()=>{const s=setup('light',true);s.changes.change();assert.equal(s.root.dataset.theme,'light');s.window.pcsThemeController.select('dark');assert.equal(s.data.pcsTheme,'dark');assert.equal(s.root.style.colorScheme,'dark')});
test('unknown values fall back to system and invalid selections are ignored',()=>{const s=setup('obsolete',true);assert.equal(s.root.dataset.theme,'dark');s.window.pcsThemeController.select('oops');assert.equal(s.root.dataset.themePreference,'system')});
test('storage denial does not prevent theme switching',()=>{const s=setup(null,false,true);s.window.pcsThemeController.select('dark');assert.equal(s.root.dataset.theme,'dark')});
test('preference is synchronized across tabs',()=>{const s=setup('light');s.events.storage({key:'pcsTheme',newValue:'dark'});assert.equal(s.root.dataset.theme,'dark');s.events.storage({key:'pcsTheme',newValue:null});assert.equal(s.root.dataset.themePreference,'system')});
