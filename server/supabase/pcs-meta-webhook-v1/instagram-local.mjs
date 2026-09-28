import { hubMessage } from './conversation-hub.mjs';

const encoder = new TextEncoder();
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const hex = (bytes) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
function equal(a, b) {
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function parseRow(body, accountId, now) {
  const prefix = `instagrapi:${accountId}`;
  const scopedId = new RegExp(`^instagrapi:${accountId}:[0-9]{1,80}$`);
  if (body?.channel !== 'instagram' || body.account !== prefix ||
      ![body.message_id, body.conversation_id, body.external_user_id].every(value => typeof value === 'string' && scopedId.test(value)) ||
      body.external_user_id === `${prefix}:${accountId}` ||
      typeof body.text !== 'string' || !body.text.trim() || body.text.length > 8000 ||
      !Number.isSafeInteger(body.timestamp) || body.timestamp <= 0 || body.timestamp > now + 60_000 ||
      typeof body.kind !== 'string' || !/^[a-z_]{1,40}$/.test(body.kind) ||
      (body.name != null && (typeof body.name !== 'string' || body.name.length > 180)) ||
      !Array.isArray(body.attachments) || body.attachments.length > 10) throw new Error('invalid_local_message');
  for (const item of body.attachments) {
    if (!item || typeof item.type !== 'string' || !/^[a-z_]{1,40}$/.test(item.type) ||
        item.requires_manual_view !== true || Object.keys(item).some(key => !['type', 'requires_manual_view'].includes(key))) {
      throw new Error('invalid_local_attachment');
    }
  }
  // No client-controlled raw payload, channel policy, transport choice or media URLs.
  return hubMessage({ channel: 'instagram', account: prefix, conversationId: body.conversation_id,
    externalUserId: body.external_user_id, messageId: body.message_id, timestamp: body.timestamp,
    text: body.text, kind: body.kind, name: body.name, attachments: body.attachments, raw: null });
}

function receipt(messageId, result) {
  if (result?.action !== 'approval_required' || typeof result.generation_id !== 'string' || !result.generation_id) {
    throw new Error('local_draft_not_persisted');
  }
  return { ok: true, accepted: true, event_id: messageId,
    action: 'approval_required', generation_id: result.generation_id };
}

// The caller provides the existing Hub processor, not channel-specific sales logic.
export async function receiveLocalInstagram({ bytes, headers, config, store, process, now = Date.now() }) {
  if (bytes.byteLength > 32768) return json({ error: 'payload_too_large' }, 413);
  if (!config || config.enabled !== true || !/^[0-9]{1,80}$/.test(String(config.account_id || '')) ||
      typeof config.hmac_secret !== 'string' || config.hmac_secret.length < 32) return json({ error: 'local_bridge_not_configured' }, 503);
  const timestamp = headers.get('x-pcs-local-timestamp') || '';
  const signature = headers.get('x-pcs-local-signature') || '';
  if (!/^[0-9]{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300_000 ||
      !/^[a-f0-9]{64}$/.test(signature)) return json({ error: 'invalid_local_signature' }, 401);
  const prefix = encoder.encode(`pcs-instagram-local-v1\n${timestamp}\n`);
  const signed = new Uint8Array(prefix.byteLength + bytes.byteLength);
  signed.set(prefix); signed.set(bytes, prefix.byteLength);
  const key = await crypto.subtle.importKey('raw', encoder.encode(config.hmac_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  if (!equal(signature, hex(await crypto.subtle.sign('HMAC', key, signed)))) return json({ error: 'invalid_local_signature' }, 401);
  let row;
  try { row = parseRow(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), String(config.account_id), now); }
  catch { return json({ error: 'invalid_local_message' }, 400); }
  const eventId = `local:${row.message_id}`;
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
  let claimed;
  try {
    claimed = await store.claim(eventId, digest);
    if (claimed.digest !== digest) return json({ error: 'local_event_content_conflict' }, 409);
    if (claimed.status === 'processed') return json(receipt(row.message_id, claimed.result));
    // A timeout is not evidence that the previous attempt stopped. Never run it concurrently.
    if (claimed.status !== 'new') return json({ error: 'local_event_unresolved' }, 409);
    const result = await process(row);
    const accepted = receipt(row.message_id, result);
    await store.complete(claimed.id, digest, result);
    return json(accepted);
  } catch {
    if (claimed?.status === 'new') await store.fail(claimed.id).catch(() => {});
    // Do not expose upstream responses, model input or database internals.
    return json({ error: 'local_event_not_completed' }, 503);
  }
}

export function localEventStore(sb) {
  return {
    async claim(eventId, digest) {
      const inserted = await sb.from('pcs_channel_events').insert({ channel: 'instagram', external_event_id: eventId,
        status: 'processing', payload: { source: 'instagrapi', digest } }).select('id').single();
      if (!inserted.error) return { id: inserted.data.id, status: 'new', digest };
      if (inserted.error.code !== '23505') throw inserted.error;
      const found = await sb.from('pcs_channel_events').select('id,status,payload')
        .eq('channel', 'instagram').eq('external_event_id', eventId).single();
      if (found.error) throw found.error;
      if (found.data.payload?.digest === digest && found.data.status === 'failed') {
        // Only a completed failed attempt may be retried. The conditional update
        // lets one retry claim the event without racing another worker.
        const retry = await sb.from('pcs_channel_events').update({ status: 'processing', error: null,
          processed_at: null }).eq('id', found.data.id).eq('status', 'failed').select('id').maybeSingle();
        if (retry.error) throw retry.error;
        if (retry.data) return { id: retry.data.id, status: 'new', digest };
      }
      return { id: found.data.id, status: found.data.status, digest: found.data.payload?.digest, result: found.data.payload?.result };
    },
    async complete(id, digest, result) {
      const updated = await sb.from('pcs_channel_events').update({ status: 'processed', processed_at: new Date().toISOString(),
        error: null, payload: { source: 'instagrapi', digest, result } }).eq('id', id).eq('status', 'processing').select('id').single();
      if (updated.error) throw updated.error;
    },
    async fail(id) {
      const updated = await sb.from('pcs_channel_events').update({ status: 'failed', error: 'local_hub_processing_failed',
        processed_at: new Date().toISOString() }).eq('id', id).eq('status', 'processing');
      if (updated.error) throw updated.error;
    },
  };
}
