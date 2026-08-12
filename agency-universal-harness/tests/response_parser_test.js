const assert = require('assert');
const parser = require('../response_parser.js');

const requestId = 'req_msqdslbc_htk66vo';
const liveResponse = '{"requestId":"req_msqdslbc_htk66vo","status":"act","action":{"type":"click","target":{"ref":"e1_29","role":"link","name":"SEO-анализатор","label":"SEO-анализатор","text":"SEO-анализатор"}},"reason":"Сначала нужно получить сайт-wide SEO-аудит Rank Math и выявить технические и контентные проблемы, прежде чем массово менять 31 опубликованную статью."}';

const parsed = parser.extractJson(liveResponse, requestId);
assert.equal(parsed.requestId, requestId);
assert.equal(parsed.status, 'act');
assert.equal(parsed.action.type, 'click');
assert.equal(parsed.action.target.ref, 'e1_29');
assert.equal(parsed.action.target.name, 'SEO-анализатор');

const withProse = `Ответ ниже:\n${liveResponse}\nГотово.`;
const parsedWithProse = parser.extractJson(withProse, requestId);
assert.equal(parsedWithProse.requestId, requestId);
assert.equal(parsedWithProse.action.target.ref, 'e1_29');

const nestedOnly = '{"ref":"e1_29","role":"link"}';
assert.throws(() => parser.extractJson(nestedOnly, requestId), /REQUEST_ID_MISMATCH/);

const wrongRequest = liveResponse.replace(requestId, 'req_wrong');
assert.throws(() => parser.extractJson(wrongRequest, requestId), /REQUEST_ID_MISMATCH/);

console.log('PASS: live nested JSON response parses as the outer action object');
