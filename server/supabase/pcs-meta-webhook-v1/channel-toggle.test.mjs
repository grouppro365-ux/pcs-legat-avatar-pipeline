import test from 'node:test';
import assert from 'node:assert/strict';
import { mayQueueLocalReply } from './channel-policy.mjs';

test('disabling Instagram in PCS prevents a new private outgoing reply', () => {
  const allowed = mayQueueLocalReply({
    config: { enabled: true, outgoing_enabled: true, account_id: '16439440842', outgoing_since: '2026-10-01T00:00:00Z' },
    connection: { enabled: false, status: 'disabled', public_config: { reply_mode: 'auto' } },
    row: { account: 'instagrapi:16439440842', timestamp: Date.parse('2026-10-01T01:00:00Z'), external_user_id: 'instagrapi:39722457607' },
    generated: { confidence: 0.99, autoSend: true, model: 'car-rental-offer-v1' },
    risk: null,
  });
  assert.equal(allowed, false);
});
