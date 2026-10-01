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
  if (!['approval_required', 'pending_send'].includes(result?.action) || typeof result.generation_id !== 'string' || !result.generation_id) {
    throw new Error('local_draft_not_persisted');
  }
  return { ok: true, accepted: true, event_id: messageId,
    action: result.action, generation_id: result.generation_id };
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

// A separate signature domain prevents replaying an incoming message as a
// request to claim or acknowledge an outgoing reply.
export async function receiveLocalOutbox({ bytes, headers, config, store, now = Date.now() }) {
  const requestClock = Date.now();
  if (bytes.byteLength > 4096) return json({ error: 'payload_too_large' }, 413);
  if (config?.enabled !== true || config?.outgoing_enabled !== true ||
      !/^[0-9]{1,80}$/.test(String(config?.account_id || '')) ||
      typeof config?.hmac_secret !== 'string' || config.hmac_secret.length < 32) {
    return json({ error: 'outgoing_disabled' }, 503);
  }
  const timestamp = headers.get('x-pcs-local-timestamp') || '';
  const signature = headers.get('x-pcs-local-signature') || '';
  if (!/^[0-9]{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300_000 ||
      !/^[a-f0-9]{64}$/.test(signature)) return json({ error: 'invalid_outbox_signature' }, 401);
  const prefix = encoder.encode(`pcs-instagram-outbox-v1\n${timestamp}\n`);
  const signed = new Uint8Array(prefix.length + bytes.length);
  signed.set(prefix); signed.set(bytes, prefix.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(config.hmac_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  if (!equal(signature, hex(await crypto.subtle.sign('HMAC', key, signed)))) {
    return json({ error: 'invalid_outbox_signature' }, 401);
  }
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (input.account_id !== String(config.account_id) || !uuid(input.request_id) || !['claim', 'ack'].includes(input.action)) throw new Error();
    if (input.action === 'ack' && (!uuid(input.generation_id) || !uuid(input.claim_id) ||
        !['sent', 'uncertain'].includes(input.status) ||
        (input.status === 'sent' && !/^[0-9]{1,80}$/.test(input.message_id || '')))) throw new Error();
  } catch { return json({ error: 'invalid_outbox_request' }, 400); }
  try {
    if (input.action === 'ack') {
      await store.ack(input);
      return json({ ok: true, acknowledged: true, generation_id: input.generation_id });
    }
    const claimed = await store.claim(String(config.account_id), input.request_id, config.pilot_recipient_ids || null);
    if (!claimed) return json({ ok: true, job: null });
    const job = claimed.job;
    const responseSeconds = Math.floor((now + Date.now() - requestClock) / 1000);
    if (!uuid(claimed.claim_id) || !uuid(job?.generation_id) || job?.account_id !== String(config.account_id) ||
        !/^[0-9]{1,80}$/.test(job?.thread_id || '') || !/^[0-9]{1,80}$/.test(job?.recipient_id || '') ||
        job.recipient_id === job.account_id || job.approved !== true ||
        typeof job.text !== 'string' || !job.text.trim() || job.text.length > 8000 ||
        !Number.isSafeInteger(job.expires_at) || job.expires_at <= responseSeconds || job.expires_at > responseSeconds + 300) {
      return json({ error: 'outbox_job_requires_review' }, 409);
    }
    const body = JSON.stringify(job);
    const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode('pcs-instagram-outbound-v1\n' + body)));
    return json({ ok: true, claim_id: claimed.claim_id, job: { body, signature } });
  } catch { return json({ error: 'outbox_not_completed' }, 503); }
}

export function localOutboxStore(sb) {
  return {
    async claim(account, requestId, recipients) {
      const settings=await sb.from('pcs_settings').select('auto_send').eq('id','main').maybeSingle();
      if(settings.error) throw settings.error;
      if(settings.data?.auto_send !== true) return null;
      const { data, error } = await sb.rpc('pcs_instagram_outbox_claim', {
        p_account: account, p_request: requestId, p_recipients: recipients,
      });
      if (error) throw error;
      return data;
    },
    async ack(input) {
      const { error } = await sb.rpc('pcs_instagram_outbox_ack', {
        p_account: input.account_id, p_generation: input.generation_id, p_claim: input.claim_id,
        p_status: input.status, p_message: input.status === 'sent' ? input.message_id : null,
      });
      if (error) throw error;
    },
  };
}


