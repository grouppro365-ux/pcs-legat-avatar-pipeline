const assert = require('assert');

globalThis.ABH_SKILLS = {};
require('../seo_article_writer_tatyana.js');
const P = require('../planner_protocol.js');

assert.equal(globalThis.ABH_SKILLS.seoArticleWriterTatyana.name, 'seo-article-writer-tatyana');
assert.equal(globalThis.ABH_SKILLS.seoArticleWriterTatyana.version, '1.0.0');

const schema = P.makeSchemaText();
assert(schema.includes('EMBEDDED SKILL: seo-article-writer-tatyana v1.0.0'));
assert(schema.includes('IndexNow alone is never “SEO optimization”'));
assert(schema.includes('Open the actual article editor'));
assert(schema.includes('Rank Math / SEO fields'));
assert(schema.includes('Process one article to verified completion before moving to the next'));
assert(schema.includes('NO RANKING PROMISES'));

const id='req_progress_1';
let v=P.validateResponse({
  requestId:id,
  status:'act',
  action:{type:'click',target:{ref:'bh1',role:'button',name:'Обновить'}},
  progress:{itemKey:'article-1',itemStatus:'completed',note:'saved'}
},id);
assert.equal(v.ok,false);
assert.equal(v.error,'PROGRESS_COMPLETED_REQUIRES_VERIFY_STEP');

v=P.validateResponse({
  requestId:id,
  status:'act',
  action:{type:'assert',target:{ref:'bh2',role:'status',name:'Запись обновлена'},includes:'обновлена'},
  progress:{itemKey:'article-1',itemStatus:'completed',note:'post-save verified'}
},id);
assert.equal(v.ok,true);

console.log('seo_skill_integration_test PASS');
