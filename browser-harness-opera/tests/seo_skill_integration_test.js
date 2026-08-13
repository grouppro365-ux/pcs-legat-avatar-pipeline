const assert = require('assert');

globalThis.ABH_SKILLS = {};
require('../seo_article_writer_tatyana.js');
const P = require('../planner_protocol.js');

assert.equal(globalThis.ABH_SKILLS.seoArticleWriterTatyana.name, 'seo-article-writer-tatyana');
assert.equal(globalThis.ABH_SKILLS.seoArticleWriterTatyana.version, '1.0.0');

const schema = P.makeSchemaText('@seo-article-writer-tatyana исправь все статьи на сайте');
assert(schema.includes('EMBEDDED SKILL: seo-article-writer-tatyana v1.0.0'));
assert(schema.includes('IndexNow alone is never “SEO optimization”'));
assert(schema.includes('Open the actual article editor'));
assert(schema.includes('Rank Math / SEO fields'));
assert(schema.includes('Process one article to verified completion before moving to the next'));
assert(schema.includes('batch.expectedTotal'));
assert(schema.includes('NO RANKING PROMISES'));

const unrelated = P.makeSchemaText('открой страницу контактов и найди телефон');
assert(!unrelated.includes('EMBEDDED SKILL: seo-article-writer-tatyana'));

const id='req_progress_1';
let v=P.validateResponse({
  requestId:id,
  status:'act',
  action:{type:'click',target:{ref:'bh1',role:'button',name:'Обновить'}},
  batch:{expectedTotal:31},
  progress:{itemKey:'article-1',itemStatus:'completed',note:'saved'}
},id);
assert.equal(v.ok,false);
assert.equal(v.error,'PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP');

v=P.validateResponse({
  requestId:id,
  status:'act',
  action:{type:'assert',target:{ref:'bh2',role:'status',name:'Запись обновлена'},includes:'обновлена'},
  batch:{expectedTotal:31},
  progress:{itemKey:'article-1',itemStatus:'completed',note:'post-save verified'}
},id);
assert.equal(v.ok,true);

v=P.validateResponse({
  requestId:id,
  status:'act',
  action:{type:'wait',textIncludes:'готово'},
  batch:{expectedTotal:0},
  progress:{itemKey:'article-1',itemStatus:'working'}
},id);
assert.equal(v.ok,false);
assert.equal(v.error,'BATCH_EXPECTED_TOTAL_INVALID');

console.log('seo_skill_integration_test PASS');
