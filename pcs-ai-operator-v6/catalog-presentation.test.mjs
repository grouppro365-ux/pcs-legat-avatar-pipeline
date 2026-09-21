import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('./interactions-v32.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('./interactions-v32.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const adapter=fs.readFileSync(new URL('./neon-adapter.js',import.meta.url),'utf8');
const safety=fs.readFileSync(new URL('./catalog-safety.js',import.meta.url),'utf8');
const catalogUx=fs.readFileSync(new URL('./operator-ux-v37.js',import.meta.url),'utf8');

assert.match(js,/titleOf=x=>String\(x\?\.title\|\|x\?\.name/,'service title must support both catalog and extras payloads');
assert.match(js,/const priceOf=x=>\[x\?\.final_price,x\?\.client_price_thb,x\?\.price,x\?\.base_price,x\?\.monthly_price/,'price fallback chain must include saved catalog prices');
assert.match(js,/Number\.isFinite\(n\)&&n>0/,'zero derived prices must not hide a valid saved tariff');
assert.doesNotMatch(js,/от \$\{money\(x\.price/,'cards must not render the broken "от —" fallback');
assert.match(js,/Цена по запросу/,'missing prices need a human-readable state');
assert.match(js,/catalogItemsForActiveFilter/,'popular products must follow the selected catalog category');
assert.match(js,/pcs-v32-cover-empty/,'products without photos need a stable placeholder');
assert.match(css,/\.pcs-ap-filter\{display:flex!important;overflow-x:auto!important/,'mobile filters must not merge labels');
assert.match(css,/\.pcs-ap-service-grid\{grid-template-columns:1fr!important/,'mobile service cards must be a readable single column');
assert.match(html,/interactions-v32\.js\?v=20260903-v35a/,'browser cache key must be bumped');
assert.match(adapter,/saveCatalogPricing/,'Mini App must send approved price and deposit updates through the manager');
assert.match(adapter,/\['delete','rules','upsert_rule','delete_rule'\]/,'Mini App must forward archive and seasonal catalog actions');
assert.match(safety,/depositThb/,'rental editor must expose a separate vehicle security deposit');
assert.match(catalogUx,/confirmDeleteCatalog/,'catalog cards must expose archive action');
assert.match(html,/neon-adapter\.js\?v=20260921-booking6/,'daily-rental adapter cache key must be bumped');

console.log('catalog presentation checks passed');
