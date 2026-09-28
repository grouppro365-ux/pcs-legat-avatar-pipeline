import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { receiveLocalInstagram } from './instagram-local.mjs';
import { mayAutoSendHubReply } from './channel-policy.mjs';
import { remoteTransportAllowed } from '../pcs-channel-send-v1/transport-policy.mjs';

const now = Date.parse('2026-09-27T10:00:00Z');
const config = { enabled: true, account_id: '77', hmac_secret: 'synthetic-test-only-key-01234567890123456789' };
const row = { channel: 'instagram', account: 'instagrapi:77', conversation_id: 'instagrapi:77:30',
  external_user_id: 'instagrapi:77:88', message_id: 'instagrapi:77:11', timestamp: now,
  text: 'Здравствуйте 👋', kind: 'text', name: 'Test', attachments: [], raw: null };
function signed(value = row, seconds = String(now / 1000)) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const signature = createHmac('sha256', config.hmac_secret).update(`pcs-instagram-local-v1\n${seconds}\n`).update(bytes).digest('hex');
  return { bytes, headers: new Headers({ 'x-pcs-local-timestamp': seconds, 'x-pcs-local-signature': signature }) };
}
function fixture() {
  const records = new Map();
  let calls = 0;
  const store = {
    async claim(eventId, digest) {
      if (records.has(eventId)) {
        const previous = records.get(eventId);
        if (previous.status === 'failed' && previous.digest === digest) {
          previous.status = 'processing';
          return { ...previous, status: 'new' };
        }
        return { ...previous };
      }
      records.set(eventId, { id: eventId, status: 'processing', digest });
      return { ...records.get(eventId), status: 'new' };
    },
    async complete(id, digest, result) { records.set(id, { id, status: 'processed', digest, result }); },
    async fail(id) { records.get(id).status = 'failed'; },
  };
  return { records, store, get calls() { return calls; }, args: { config, now, store,
    process: async (message) => { calls++; assert.equal(message.raw, null); return { action: 'approval_required', generation_id: 'draft-1' }; } } };
}

test('signed local message reaches the same Hub once; replay gets the original receipt', async () => {
  const f = fixture();
  const first = await receiveLocalInstagram({ ...f.args, ...signed() });
  assert.equal(first.status, 200);
  const receipt = await first.json();
  assert.equal(receipt.action, 'approval_required');
  assert.equal(receipt.event_id, row.message_id);
  const replay = await receiveLocalInstagram({ ...f.args, ...signed() });
  assert.deepEqual(await replay.json(), receipt);
  assert.equal(f.calls, 1);
});

test('missing, disabled, stale, future or tampered authentication never writes or calls AI', async () => {
  const f = fixture();
  const tampered = signed();
  tampered.bytes = new TextEncoder().encode(JSON.stringify({ ...row, text: 'tampered' }));
  for (const request of [{ ...signed(), config: null }, { ...signed(), config: { ...config, enabled: false } },
    signed(row, String(now / 1000 - 301)), signed(row, String(now / 1000 + 301)), tampered,
    { ...signed(), headers: new Headers() }]) {
    const response = await receiveLocalInstagram({ ...f.args, ...request });
    assert.ok([401, 503].includes(response.status));
  }
  assert.equal(f.calls, 0);
  assert.equal(f.records.size, 0);
});

test('account isolation, identity, text and timestamp validation happen before storage', async () => {
  const f = fixture();
  for (const patch of [{ account: 'instagrapi:99' }, { external_user_id: 'instagrapi:99:88' },
    { external_user_id: 'instagrapi:77:77' }, { message_id: 'graph-id' }, { text: '' },
    { text: 'a'.repeat(8001) }, { timestamp: 'NaN' }, { timestamp: now + 61000 },
    { channel: 'telegram' }, { attachments: [{ type: 'photo', url: 'https://private.invalid' }] }]) {
    assert.equal((await receiveLocalInstagram({ ...f.args, ...signed({ ...row, ...patch }) })).status, 400);
  }
  assert.equal(f.records.size, 0);
});

test('changed contents under an existing message ID are not acknowledged', async () => {
  const f = fixture();
  await receiveLocalInstagram({ ...f.args, ...signed() });
  const response = await receiveLocalInstagram({ ...f.args, ...signed({ ...row, text: 'different' }) });
  assert.equal(response.status, 409);
  assert.equal(f.calls, 1);
});

test('AI/storage failure is not acknowledged and a later retry can recover', async () => {
  const f = fixture();
  const args = { ...f.args, process: async () => { throw new Error('synthetic upstream private error'); } };
  const failed = await receiveLocalInstagram({ ...args, ...signed() });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private error/);
  const retry = await receiveLocalInstagram({ ...f.args, ...signed() });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).action, 'approval_required');
  assert.equal(f.calls, 1);
});

test('an in-progress request is not processed concurrently', async () => {
  const f = fixture();
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = receiveLocalInstagram({ ...f.args, ...signed(), process: async () => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return { action: 'approval_required', generation_id: 'draft-1' };
  } });
  await ready;
  assert.equal((await receiveLocalInstagram({ ...f.args, ...signed() })).status, 409);
  release();
  assert.equal((await first).status, 200);
});

test('server receipt persistence failure is not acknowledged', async () => {
  const f = fixture();
  f.store.complete = async () => { throw new Error('database unavailable'); };
  assert.equal((await receiveLocalInstagram({ ...f.args, ...signed() })).status, 503);
  assert.equal(f.calls, 1);
  assert.equal((await receiveLocalInstagram({ ...f.args, ...signed() })).status, 503);
  assert.equal(f.calls, 2);
});

test('pilot cannot acknowledge a sent response or an unpersisted draft', async () => {
  for (const result of [{ action: 'sent', generation_id: 'x' }, { duplicate: true }, { action: 'approval_required' }]) {
    const f = fixture();
    const response = await receiveLocalInstagram({ ...f.args, ...signed(), process: async () => result });
    assert.equal(response.status, 503);
  }
});

test('oversized requests are rejected before authentication and storage', async () => {
  const f = fixture();
  const response = await receiveLocalInstagram({ ...f.args, ...signed(), bytes: new Uint8Array(32769) });
  assert.equal(response.status, 413);
  assert.equal(f.records.size, 0);
});

test('local pilot remains draft even when channel and global auto-send are on', () => {
  const settings = { connection: { enabled: true, status: 'active' }, replyMode: 'auto', generated: { autoSend: true, model: 'tested' }, risk: null };
  assert.equal(mayAutoSendHubReply(settings), true);
  assert.equal(mayAutoSendHubReply({ ...settings, localDraft: true }), false);
  assert.equal(remoteTransportAllowed('instagram', 'instagrapi:77:88'), false);
  assert.equal(remoteTransportAllowed('instagram', '12345'), true);
  assert.equal(remoteTransportAllowed('telegram', '12345'), true);
});
