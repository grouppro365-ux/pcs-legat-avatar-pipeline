import { createClient } from 'jsr:@supabase/supabase-js@2';

const BASE = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CHANNELS = new Set(['whatsapp', 'instagram', 'facebook', 'line']);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
});
async function secret(name: string) {
  const { data, error } = await sb.rpc('pcs_secret_get', { p_name: name });
  if (error) throw error;
  return String(data || '');
}

async function configuration(channel: string) {
  const { data, error } = await sb.from('pcs_channel_connections').select('*').eq('channel', channel).maybeSingle();
  if (error) throw error;
  if (!data || !['credentials_ok', 'active'].includes(String(data.status || ''))) throw new Error(`${channel}_credentials_not_verified`);
  return data.public_config || {};
}

async function recipient(contactId: string, channel: string) {
  const { data, error } = await sb.from('pcs_contacts').select('*').eq('id', contactId).single();
  if (error) throw error;
  const id = channel === 'line' ? data.line_contact : data[channel];
  if (!id) throw new Error(`${channel}_recipient_missing`);
  return { contact: data, id: String(id) };
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url: string, init: RequestInit, provider: string) {
  let lastStatus = 0;
  let lastPayload: any = {};
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      lastStatus = response.status;
      lastPayload = await response.json().catch(() => ({}));
      if (response.ok) return lastPayload;
      // Only LINE supplies a retry key. A timeout/5xx on the other message
      // endpoints is not proof of non-delivery, so do not blindly resend.
      if (response.status !== 429 && !(provider === 'line' && response.status >= 500)) break;
      const retryAfter = Math.min(Number(response.headers.get('retry-after') || 0) * 1000, 5_000);
      if (attempt < 3) await delay(retryAfter || attempt * 750);
    } catch (error) {
      lastPayload = { error: error instanceof Error ? error.message : String(error) };
      if (provider !== 'line') break;
      if (attempt < 3) await delay(attempt * 750);
    } finally {
      clearTimeout(timeout);
    }
  }
  const providerMessage = String(lastPayload?.error?.message || lastPayload?.message || lastPayload?.error || '').slice(0, 300);
  throw new Error(`${provider}_send_failed${lastStatus ? `_${lastStatus}` : ''}${providerMessage ? `: ${providerMessage}` : ''}`);
}

async function meta(channel: string, to: string, text: string, config: any) {
  const token = await secret(`channel_${channel}_access_token`);
  if (!token) throw new Error(`${channel}_access_token_missing`);
  const version = String(config.graph_version || 'v23.0').replace(/^\/?/, '');
  let owner = '';
  let body: any;
  if (channel === 'whatsapp') {
    owner = String(config.phone_number_id || '');
    body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  } else if (channel === 'facebook') {
    owner = String(config.page_id || '');
    body = { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text } };
  } else {
    owner = String(config.instagram_account_id || '');
    body = { recipient: { id: to }, message: { text } };
  }
  if (!owner) throw new Error(`${channel}_owner_id_missing`);
  const host = channel === 'instagram' && config.api_login === 'instagram_login' ? 'graph.instagram.com' : 'graph.facebook.com';
  const payload = await fetchWithRetry(`https://${host}/${version}/${encodeURIComponent(owner)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, 'meta');
  return { raw: payload, id: String(payload?.messages?.[0]?.id || payload?.message_id || '') || null };
}

let botHelpToken = '';
let botHelpTokenExpiresAt = 0;

async function botHelpAccessToken() {
  if (botHelpToken && Date.now() < botHelpTokenExpiresAt) return botHelpToken;
  const clientId = await secret('channel_instagram_bothelp_client_id');
  const clientSecret = await secret('channel_instagram_bothelp_client_secret');
  if (!clientId || !clientSecret) throw new Error('bothelp_credentials_missing');
  const form = new FormData();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  const response = await fetch('https://oauth.bothelp.io/oauth2/token', { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error(`bothelp_auth_failed_${response.status}`);
  botHelpToken = String(payload.access_token);
  botHelpTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 120) * 1000;
  return botHelpToken;
}

async function botHelp(to: string, text: string) {
  const token = await botHelpAccessToken();
  const payload = await fetchWithRetry(`https://api.bothelp.io/v1/subscribers/${encodeURIComponent(to)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.api+json' },
    body: JSON.stringify([{ content: text }]),
  }, 'bothelp');
  return { raw: payload, id: String(payload?.data?.id || payload?.id || '') || null };
}

async function line(to: string, text: string) {
  const token = await secret('channel_line_channel_access_token');
  if (!token) throw new Error('line_access_token_missing');
  const retryKey = crypto.randomUUID();
  const payload = await fetchWithRetry('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Line-Retry-Key': retryKey },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  }, 'line');
  return { raw: { ...payload, retry_key: retryKey }, id: null };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body: any = {};
  try {
    const expected = await secret('internal_retry_secret').catch(() => '');
    if (!expected || request.headers.get('x-pcs-internal-secret') !== expected) return json({ error: 'forbidden' }, 403);
    body = await request.json();
    const channel = String(body?.channel || '').toLowerCase();
    const contactId = String(body?.contact_id || '');
    const text = String(body?.text || '').trim();
    if (!CHANNELS.has(channel) || !contactId || !text) return json({ error: 'channel_contact_text_required' }, 400);
    if (text.length > 1800) return json({ error: 'message_too_long' }, 400);
    const config = await configuration(channel);
    const target = await recipient(contactId, channel);
    const sent = channel === 'line'
      ? await line(target.id, text)
      : channel === 'instagram' && String(config.transport || 'meta') === 'bothelp'
        ? await botHelp(target.id, text)
        : await meta(channel, target.id, text, config);
    const { data: message, error } = await sb.from('pcs_messages').insert({
      contact_id: contactId,
      direction: 'out',
      text,
      status: 'sent',
      raw: { source: 'pcs-channel-send-v1', transport: String(config.transport || channel), request_id: String(body?.request_id || ''), provider_message_id: sent.id },
      contact_name: target.contact.name || null,
      channel,
      external_message_id: sent.id,
      external_chat_id: target.id,
    }).select('id').single();
    if (error) throw error;
    return json({ ok: true, message_id: message.id, external_message_id: sent.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (body?.contact_id) {
      try {
        if (body.channel === 'instagram') {
          await sb.from('pcs_tasks').insert({
            contact_id: body.contact_id,
            title: 'Instagram: проверить доставку ответа',
            comment: `Доставка не подтверждена: ${message.slice(0, 700)}. Проверьте переписку перед повторной отправкой.`,
            priority: 'HIGH',
            due_at: new Date().toISOString(),
          });
        } else await sb.from('pcs_failed_jobs').insert({
          operation: `${String(body?.channel || 'channel')}_send`,
          payload: { contact_id: body.contact_id, request_id: body?.request_id || null },
          error: message.slice(0, 1000),
          contact_id: body.contact_id,
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        });
      } catch { /* the primary send error remains the response */ }
    }
    return json({ ok: false, error: message }, 502);
  }
});
