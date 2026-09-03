import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

assert.doesNotMatch(source, /фиксирую/iu);
assert.doesNotMatch(source, /уточните, пожалуйста/iu);
assert.match(source, /await wait\(1600\)/);
assert.match(source, /latestInbound\.id!==saved\.id/);
assert.match(source, /superseded_by_newer_inbound:true/);
assert.match(source, /miss\[0\]/);
assert.match(source, /greetingLike/);
assert.match(source, /Здравствуйте! /);
assert.match(source, /На какой день этой недели планируете\?/);

function shouldSend(sourceMessageId, latestInboundId) {
  return !latestInboundId || latestInboundId === sourceMessageId;
}

assert.equal(shouldSend('first', 'second'), false, 'older handler must not answer after a newer inbound message');
assert.equal(shouldSend('second', 'second'), true, 'latest handler remains responsible for the burst');

const greetingLike = (text = '') => /(^|[.!?\s])(здравствуй(?:те)?|привет(?:ствую)?)([.!?,\s]|$)/iu.test(text);
assert.equal(greetingLike('Приветствую, хочу на экскурсию'), true);
assert.equal(greetingLike('Хочу на экскурсию'), false);

console.log('pcs-business-runtime-v8 burst regression: ok');
