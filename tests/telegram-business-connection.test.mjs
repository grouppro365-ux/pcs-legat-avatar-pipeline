import assert from 'node:assert/strict';
import test from 'node:test';
import {connectionRecord} from '../server/supabase/pcs-tg-gateway/business-connection.mjs';

test('stores enabled connection and its granted rights', () => {
  const record = connectionRecord({
    id: 'connection-1', user: {id: 8507417731}, user_chat_id: 8507417731,
    is_enabled: true, rights: {can_reply: true, can_read_messages: true}
  }, '2026-09-23T00:00:00.000Z');
  assert.equal(record.business_user_id, 8507417731);
  assert.equal(record.user_chat_id, 8507417731);
  assert.equal(record.enabled, true);
  assert.equal(record.can_reply, true);
  assert.equal(record.can_read_messages, true);
  assert.equal(record.updated_at, '2026-09-23T00:00:00.000Z');
});

test('revoked connection cannot retain operational rights', () => {
  const record = connectionRecord({
    id: 'connection-1', user: {id: 8507417731}, user_chat_id: 8507417731,
    is_enabled: false, rights: {can_reply: true, can_read_messages: true}
  });
  assert.equal(record.enabled, false);
  assert.equal(record.can_reply, false);
  assert.equal(record.can_read_messages, false);
});

test('rejects incomplete business events', () => {
  assert.throws(() => connectionRecord({id: 'connection-1', is_enabled: true}), /invalid_business_connection/);
});
