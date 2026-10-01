import test from 'node:test';
import assert from 'node:assert/strict';
import { localOutboxStore } from './instagram-local.mjs';

test('disabled Instagram leaves previously queued replies unclaimed', async () => {
  let claims = 0;
  const sb = {
    from(table) {
      const result = table === 'pcs_settings'
        ? { data: { auto_send: true }, error: null }
        : { data: { enabled: false, status: 'disabled', public_config: { reply_mode: 'auto' } }, error: null };
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return result; } };
    },
    async rpc() { claims++; return { data: { claim_id: 'should-not-be-issued' }, error: null }; },
  };
  assert.equal(await localOutboxStore(sb).claim('16439440842', 'request-1', null), null);
  assert.equal(claims, 0);
});
