import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('./operator-ux-v37.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('./operator-ux-v37.css',import.meta.url),'utf8');

assert.match(html,/operator-ux-v37\.css\?v=20260921-sheet1/);
assert.match(html,/operator-ux-v37\.js\?v=20260920-catalog1/);
assert.match(js,/item\('dashboard','Главная'/);
assert.match(js,/Партнёр:/);
assert.match(js,/Контакт:/);
assert.match(js,/pcsCatalogFilter37\('transfer'/);
assert.match(js,/pcsCatalogFilter37\('visa'/);
assert.match(js,/pcsExtraFilter37\('medicine'/);
assert.match(css,/\.pcs-ap-service-grid\{display:grid!important;grid-template-columns:1fr!important/);
assert.match(css,/\.v37-catalog-list\{display:grid/);
assert.match(css,/\.sheet\.on\{z-index:200!important\}/,'open sheets must be above the mobile navigation');

console.log('operator ux v37 checks passed');
