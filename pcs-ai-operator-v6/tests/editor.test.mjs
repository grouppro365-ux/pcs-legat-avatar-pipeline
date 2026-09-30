import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function knowledgeHarness(rows=[]) {
  const sheets=[]; const notices=[];
  const window={__PCS_KB_ROWS__:rows};
  const context={window,document:{},esc:value=>String(value??''),
    openSheet:(title,html)=>sheets.push({title,html}),toast:value=>notices.push(value)};
  vm.runInNewContext(readFileSync(new URL('../knowledge-editor.js',import.meta.url),'utf8'),context);
  return {window,sheets,notices};
}

test('edit opens the selected v26 knowledge record with its existing values',()=>{
  const entry={id:'kb-existing',title:'Ford Focus',description:'400 THB daily',category:'car_rent'};
  const h=knowledgeHarness([entry]);
  h.window.editKnowledge(entry.id);
  assert.equal(h.sheets[0]?.title,'Редактировать запись');
  assert.match(h.sheets[0].html,/value="Ford Focus"/);
  assert.match(h.sheets[0].html,/400 THB daily/);
  assert.match(h.sheets[0].html,/saveKnowledge\('kb-existing'\)/);
});
test('all changed runtime files have the same release cache key',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const file of ['neon-adapter.js','operator-ux-v37.js','media.js'])assert.ok(html.includes(file+'?v=20260930-catalog-media1'),file+' must refresh in Telegram');
});

test('unknown record never silently opens a creation form',()=>{
  const h=knowledgeHarness([{id:'existing',title:'Existing'}]);
  h.window.editKnowledge('missing-record');
  assert.equal(h.sheets.length,0,'unknown record must not open creation form');
  assert.equal(h.notices.length,1);
});

test('mini app uses a fresh cache key for the repaired editor',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/knowledge-editor\.js\?v=20260930-kb-edit1/, 'fresh cache key required');
});
