import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('./interactions-v32.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('./interactions-v32.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

assert.match(js,/titleOf=x=>String\(x\?\.title\|\|x\?\.name/,'service title must support both catalog and extras payloads');
assert.match(js,/final_price\?\?x\?\.client_price_thb\?\?x\?\.price\?\?x\?\.base_price\?\?x\?\.monthly_price/,'price fallback chain must include saved catalog prices');
assert.doesNotMatch(js,/от \$\{money\(x\.price/,'cards must not render the broken "от —" fallback');
assert.match(js,/Цена по запросу/,'missing prices need a human-readable state');
assert.match(js,/catalogItemsForActiveFilter/,'popular products must follow the selected catalog category');
assert.match(js,/pcs-v32-cover-empty/,'products without photos need a stable placeholder');
assert.match(css,/\.pcs-ap-filter\{display:flex!important;overflow-x:auto!important/,'mobile filters must not merge labels');
assert.match(css,/\.pcs-ap-service-grid\{grid-template-columns:1fr!important/,'mobile service cards must be a readable single column');
assert.match(html,/interactions-v32\.js\?v=20260903-v34a/,'browser cache key must be bumped');

console.log('catalog presentation checks passed');
