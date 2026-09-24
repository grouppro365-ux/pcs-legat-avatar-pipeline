import { createClient } from 'jsr:@supabase/supabase-js@2';
import { languageForMessage, socialIntent, socialReply } from './social.mjs';
import { buildSystemPrompt, humanRisk } from './journey.mjs';
import { parseBotHelpPayload } from './bothelp.mjs';
import { hubMessage } from './conversation-hub.mjs';
import { shouldGenerateCustomerReply } from './channel-policy.mjs';
import { carRentalJourney } from './car-rental-journey.mjs';

const BASE = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
// LINE continues using its existing signed receiver until Hub E2E is verified.
const CHANNELS = new Set(['whatsapp', 'instagram', 'facebook']);
const META_SEND = BASE + '/functions/v1/pcs-channel-send-v1';
const BOTHELP_WEBHOOK = BASE + '/functions/v1/pcs-meta-webhook-v1?channel=instagram&source=bothelp';
const MAX_BODY_BYTES = 1_048_576;
const ADMIN_ORIGINS = new Set([
  'https://grouppro365-ux.github.io',
  'https://pcs-concierge-stable.grouppro365.chatgpt.site',
  'https://pcs-ai-operator-grouppro365-2288s-projects.vercel.app',
  'https://pcs-ai-operator-f6gz02q7t-grouppro365-2288s-projects.vercel.app',
]);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
});

async function secret(name: string) {
  const { data, error } = await sb.rpc('pcs_secret_get', { p_name: name });
  if (error) throw error;
  return String(data || '');
}

async function secretPut(name: string, value: string) {
  if (!value) return;
  const { error } = await sb.rpc('pcs_secret_upsert', { p_name: name, p_value: value });
  if (error) throw error;
}

function adminCors(request: Request) {
  const origin = request.headers.get('origin') || '';
  return {
    'access-control-allow-origin': ADMIN_ORIGINS.has(origin) ? origin : 'https://pcs-concierge-stable.grouppro365.chatgpt.site',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    vary: 'Origin',
  };
}

const adminJson = (request: Request, data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...adminCors(request), 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
});

async function managerAuth(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization) return false;
  try { return (await fetch(BASE + '/functions/v1/pcs-manager-live2?op=session', { headers: { authorization, accept: 'application/json' } })).ok; }
  catch { return false; }
}

async function botHelpState() {
  const { data } = await sb.from('pcs_channel_connections').select('*').eq('channel', 'instagram').maybeSingle();
  const [clientId, clientSecret, webhookSecret] = await Promise.all([
    secret('channel_instagram_bothelp_client_id').catch(() => ''),
    secret('channel_instagram_bothelp_client_secret').catch(() => ''),
    secret('channel_instagram_bothelp_webhook_secret').catch(() => ''),
  ]);
  return { ...data, webhook_url: BOTHELP_WEBHOOK, configured: { client_id: !!clientId, client_secret: !!clientSecret, webhook_secret: !!webhookSecret } };
}

async function configureBotHelp(body: any) {
  const values = body?.secrets || {};
  await Promise.all([
    secretPut('channel_instagram_bothelp_client_id', String(values.bothelp_client_id || '').trim()),
    secretPut('channel_instagram_bothelp_client_secret', String(values.bothelp_client_secret || '').trim()),
    secretPut('channel_instagram_bothelp_webhook_secret', String(values.bothelp_webhook_secret || '').trim()),
  ]);
  const { data: current } = await sb.from('pcs_channel_connections').select('public_config').eq('channel', 'instagram').maybeSingle();
  const publicConfig = { ...(current?.public_config || {}), transport: 'bothelp', reply_mode: 'draft' };
  const { error } = await sb.from('pcs_channel_connections').upsert({ channel: 'instagram', enabled: false, status: 'configured', public_config: publicConfig, last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'channel' });
  if (error) throw error;
  return botHelpState();
}

async function testBotHelp() {
  const clientId = await secret('channel_instagram_bothelp_client_id');
  const clientSecret = await secret('channel_instagram_bothelp_client_secret');
  const webhookSecret = await secret('channel_instagram_bothelp_webhook_secret');
  if (!clientId) throw new Error('Не задан BotHelp Client ID');
  if (!clientSecret) throw new Error('Не задан BotHelp Client Secret');
  if (!webhookSecret) throw new Error('Не задан секрет входящего запроса');
  const form = new FormData();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  const response = await fetch('https://oauth.bothelp.io/oauth2/token', { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || payload?.error || `BotHelp ${response.status}`);
  await sb.from('pcs_channel_connections').update({ enabled: false, status: 'credentials_ok', last_checked_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('channel', 'instagram');
  return { ok: true, name: 'BotHelp', expires_in: Number(payload.expires_in || 0) || null, webhook_url: BOTHELP_WEBHOOK };
}

async function botHelpReadiness() {
  const [{ count: incoming }, { count: outgoing }, connection] = await Promise.all([
    sb.from('pcs_channel_events').select('*', { head: true, count: 'exact' }).eq('channel', 'instagram').eq('status', 'processed').contains('payload', { source: 'bothelp' }),
    sb.from('pcs_messages').select('*', { head: true, count: 'exact' }).eq('channel', 'instagram').eq('direction', 'out').eq('status', 'sent').contains('raw', { transport: 'bothelp' }),
    botHelpState(),
  ]);
  const credentialsOk = ['credentials_ok', 'active'].includes(String(connection.status || ''));
  return { credentials_ok: credentialsOk, incoming_processed: incoming || 0, outgoing_sent: outgoing || 0, ready: credentialsOk && (incoming || 0) > 0 && (outgoing || 0) > 0, webhook_url: BOTHELP_WEBHOOK };
}

async function handleBotHelpAdmin(request: Request, url: URL) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: adminCors(request) });
  if (!(await managerAuth(request))) return adminJson(request, { error: 'Требуется вход администратора' }, 401);
  const route = (url.pathname.split('/bothelp-admin/')[1] || 'state').split('/')[0];
  try {
    if (route === 'state' && request.method === 'GET') return adminJson(request, await botHelpState());
    if (route === 'configure' && ['POST', 'PUT'].includes(request.method)) return adminJson(request, await configureBotHelp(await request.json()));
    if (route === 'test' && request.method === 'POST') return adminJson(request, await testBotHelp());
    if (route === 'readiness' && request.method === 'POST') {
      const ready = await botHelpReadiness();
      if (!ready.ready) return adminJson(request, { ok: false, ...ready, error: 'Нужны: проверенные ключи, реальное сообщение через BotHelp и один одобренный исходящий ответ' }, 409);
      await sb.from('pcs_channel_connections').update({ enabled: true, status: 'active', last_checked_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('channel', 'instagram');
      return adminJson(request, { ok: true, ...await botHelpReadiness() });
    }
    if (route === 'disable' && request.method === 'POST') {
      await sb.from('pcs_channel_connections').update({ enabled: false, status: 'disabled', last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('channel', 'instagram');
      return adminJson(request, { ok: true });
    }
    return adminJson(request, { error: 'Маршрут не найден' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return adminJson(request, { error: message }, 400);
  }
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(keyText: string, bytes: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, bytes);
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function attachmentText(kind: string, language: string) {
  if (language === 'th') return `[ลูกค้าส่ง${kind === 'voice' ? 'ข้อความเสียง' : 'ไฟล์หรือรูปภาพ'}]`;
  if (language === 'ru') return `[Клиент отправил ${kind === 'voice' ? 'голосовое сообщение' : 'файл или изображение'}]`;
  return `[Customer sent ${kind === 'voice' ? 'a voice message' : 'a file or image'}]`;
}

function parseMessenger(body: any, channel = 'facebook') {
  const rows: any[] = [];
  for (const entry of body?.entry || []) {
    for (const event of entry?.messaging || []) {
      if (event?.message?.is_echo || event?.message?.is_deleted) continue;
      const sender = String(event?.sender?.id || '');
      const messageId = String(event?.message?.mid || event?.postback?.mid || '');
      if (!sender || !messageId) continue;
      let text = String(event?.message?.text || event?.postback?.title || event?.postback?.payload || '').trim();
      let kind = 'text';
      const attachments = Array.isArray(event?.message?.attachments) ? event.message.attachments : [];
      if (!text && attachments.length) {
        kind = String(attachments[0]?.type || 'attachment');
        text = attachmentText(kind, 'ru');
      }
      if (!text) continue;
      rows.push(hubMessage({ channel, account: String(event?.recipient?.id || entry?.id || ''), conversationId: sender, externalUserId: sender, messageId, text, kind, attachments, timestamp: event.timestamp, raw: event }));
    }
  }
  return rows;
}

function parseWhatsApp(body: any) {
  const rows: any[] = [];
  for (const entry of body?.entry || []) for (const change of entry?.changes || []) {
    const value = change?.value || {};
    const contacts = new Map((value.contacts || []).map((contact: any) => [String(contact.wa_id || ''), contact.profile?.name || null]));
    for (const message of value.messages || []) {
      const sender = String(message.from || '');
      let text = String(message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '').trim();
      let kind = 'text';
      if (!text && (message.image || message.audio || message.document || message.video)) {
        kind = message.audio ? 'voice' : message.image ? 'image' : message.video ? 'video' : 'document';
        text = attachmentText(kind, 'ru');
      }
      if (sender && message.id && text) rows.push(hubMessage({ channel: 'whatsapp', account: String(value.metadata?.phone_number_id || entry?.id || ''), conversationId: sender, externalUserId: sender, messageId: String(message.id), text, kind, name: contacts.get(sender) || null, timestamp: message.timestamp, raw: message }));
    }
  }
  return rows;
}

function parseLine(body: any) {
  const rows: any[] = [];
  for (const event of body?.events || []) {
    const sender = String(event?.source?.userId || event?.source?.groupId || event?.source?.roomId || '');
    const messageId = String(event?.message?.id || event?.webhookEventId || '');
    if (!sender || !messageId || event?.type !== 'message') continue;
    let text = String(event?.message?.text || '').trim();
    const kind = String(event?.message?.type || 'text');
    if (!text && kind !== 'text') text = attachmentText(kind, 'ru');
    if (!text) continue;
    rows.push(hubMessage({ channel: 'line', account: String(body?.destination || ''), conversationId: sender, externalUserId: sender, messageId, text, kind, timestamp: event?.timestamp, raw: event }));
  }
  return rows;
}

async function contactFor(channel: string, externalId: string, name: string | null) {
  const field = channel === 'whatsapp' ? 'whatsapp' : channel === 'line' ? 'line_contact' : channel;
  let { data: contact } = await sb.from('pcs_contacts').select('*').eq(field, externalId).order('last_contact_at', { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
  if (!contact) {
    const record: any = { name: name || `${channel.toUpperCase()} ${externalId.slice(-6)}`, status: 'NEW', priority: 'NORMAL', preferred_channel: channel, last_contact_at: now, detected_language: null };
    record[field] = externalId;
    if (channel === 'whatsapp') record.phone = externalId;
    const inserted = await sb.from('pcs_contacts').insert(record).select('*').single();
    if (inserted.error) {
      const retry = await sb.from('pcs_contacts').select('*').eq(field, externalId).limit(1).maybeSingle();
      if (retry.error || !retry.data) throw inserted.error;
      contact = retry.data;
    } else contact = inserted.data;
  }
  const patch: any = { preferred_channel: channel, last_contact_at: now };
  if (name && !contact.name) patch.name = name;
  await sb.from('pcs_contacts').update(patch).eq('id', contact.id);
  return { ...contact, ...patch };
}

async function intentOf(text: string) {
  try {
    const { data } = await sb.rpc('pcs_strong_intent_from_text', { p_text: text });
    return data || null;
  } catch {
    return null;
  }
}

async function ingest(channel: string, row: any) {
  const contact = await contactFor(channel, row.external_user_id, row.name);
  const language = languageForMessage(row.text, contact.detected_language);
  const social = socialIntent(row.text);
  const intent = social ? null : await intentOf(row.text);
  const createdAt = row.timestamp ? new Date(row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp).toISOString() : new Date().toISOString();
  const inserted = await sb.from('pcs_messages').upsert({
    contact_id: contact.id,
    direction: 'in',
    text: row.text,
    status: 'received',
    raw: {
      source: 'pcs-meta-webhook-v1',
      media_kind: row.kind,
      attachment_types: (row.attachments || []).map((item: any) => String(item?.type || 'attachment')).slice(0, 10),
    },
    contact_name: row.name || contact.name || null,
    intent,
    channel,
    external_message_id: row.message_id,
    external_chat_id: row.conversation_id,
    created_at: createdAt,
  }, { onConflict: 'channel,external_message_id,direction', ignoreDuplicates: true }).select('id').maybeSingle();
  if (inserted.error) throw inserted.error;
  if (!inserted.data?.id) return null;
  const contactPatch: any = { detected_language: language, last_contact_at: createdAt };
  if (!social) {
    if (intent) contactPatch.intent = intent;
    if (!contact.need || (intent && intent !== 'other' && intent !== contact.intent)) contactPatch.need = row.text;
    if (['NEW', 'WAITING_CLIENT'].includes(String(contact.status || '').toUpperCase())) {
      contactPatch.status = 'QUALIFYING';
      contactPatch.next_action = 'Уточнить параметры запроса';
    }
  }
  await sb.from('pcs_contacts').update(contactPatch).eq('id', contact.id);
  return { messageId: inserted.data.id, contact: { ...contact, ...contactPatch }, language };
}

function safeFallback(language: string) {
  if (language === 'th') return 'ขอบคุณสำหรับข้อความค่ะ กรุณาระบุเมือง วันที่ จำนวนคน และงบประมาณ ทีมงานจะตรวจสอบและตอบกลับโดยเร็วที่สุด';
  if (language === 'en') return 'Thank you for your message. Please share the city, dates, number of people, and budget so we can check the details.';
  return 'Спасибо за сообщение. Уточните, пожалуйста, город, даты, количество человек и бюджет — мы проверим детали.';
}

async function knowledgeContext() {
  const now = new Date().toISOString();
  const { data } = await sb.from('pcs_knowledge_items')
    .select('id,title,description,city,price,currency,conditions,restrictions,answer_guidance')
    .eq('status', 'active')
    .eq('visibility', 'customer_safe')
    .eq('auto_answer_allowed', true)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('verified_at', { ascending: false, nullsFirst: false })
    .limit(40);
  const ids = (data || []).map((item: any) => item.id);
  const text = (data || []).map((item: any) => [item.title, item.description, item.city, item.price != null ? `${item.price} ${item.currency || 'THB'}` : '', item.conditions, item.restrictions, item.answer_guidance].filter(Boolean).join(' | ')).join('\n');
  return { ids, text };
}

async function generate(contactId: string, sourceMessageId: string, text: string, language: string) {
  const social = socialIntent(text);
  if (social) {
    const { data: settings } = await sb.from('pcs_settings').select('auto_send').eq('id', 'main').maybeSingle();
    return { answer: socialReply(language, social), provider: 'deterministic', model: `social-${social}`, confidence: 1, knowledgeIds: [], autoSend: !!settings?.auto_send };
  }
  const [{ data: settings }, { data: history }, kb] = await Promise.all([
    sb.from('pcs_settings').select('tokenrouter_model,openrouter_model,ai_provider_order,min_confidence,auto_send').eq('id', 'main').maybeSingle(),
    sb.from('pcs_messages').select('direction,text').eq('contact_id', contactId).neq('id', sourceMessageId).order('created_at', { ascending: false }).limit(12),
    knowledgeContext(),
  ]);
  const order = Array.isArray(settings?.ai_provider_order) ? settings.ai_provider_order : ['tokenrouter', 'openrouter'];
  const system = buildSystemPrompt(language, kb.text);
  const messages = [{ role: 'system', content: system }, ...(history || []).reverse().map((item: any) => ({ role: item.direction === 'out' ? 'assistant' : 'user', content: String(item.text || '') })), { role: 'user', content: text }];
  for (const provider of order) {
    if (!['tokenrouter', 'openrouter'].includes(provider)) continue;
    const key = await secret(provider + '_key').catch(() => '');
    if (!key) continue;
    const model = provider === 'tokenrouter' ? (settings?.tokenrouter_model || 'moonshotai/kimi-k3') : (settings?.openrouter_model || 'openai/gpt-4o-mini');
    const base = provider === 'tokenrouter' ? 'https://api.tokenrouter.com/v1' : 'https://openrouter.ai/api/v1';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(base + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.2, max_tokens: 280, messages }), signal: controller.signal });
      clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      const answer = String(payload?.choices?.[0]?.message?.content || '').trim();
      if (response.ok && answer) return { answer: answer.slice(0, 1800), provider, model, confidence: Number(settings?.min_confidence || 0.9), knowledgeIds: kb.ids, autoSend: !!settings?.auto_send };
    } catch (error) {
      console.error('instagram_ai_provider_failed', provider, error instanceof Error ? error.message : String(error));
    }
  }
  return { answer: safeFallback(language), provider: 'deterministic', model: 'safe-fallback', confidence: 0.5, knowledgeIds: [], autoSend: !!settings?.auto_send };
}

async function structuredCarRentalReply(contactId: string, text: string) {
  const [{ data: history }, { data: settings }] = await Promise.all([
    sb.from('pcs_messages').select('direction,text').eq('contact_id', contactId).eq('direction', 'in').not('text', 'is', null).order('created_at', { ascending: false }).limit(20),
    sb.from('pcs_settings').select('auto_send').eq('id', 'main').maybeSingle(),
  ]);
  const journey = carRentalJourney((history || []).map((message: any) => String(message.text || '')).reverse(), text);
  if (!journey.matches) return null;
  if (journey.question) {
    return {
      answer: `Помогу подобрать автомобиль в аренду. ${journey.question}`,
      provider: 'deterministic',
      model: 'car-rental-qualification-v1',
      confidence: 1,
      knowledgeIds: [],
      autoSend: !!settings?.auto_send,
      intent: 'car_rent',
    };
  }
  const { data: catalog, error } = await sb.from('pcs_catalog_items')
    .select('id,title,city,location,currency,availability_note,status,customer_visible,deleted_at')
    .eq('category', 'car_rent')
    .eq('status', 'available')
    .eq('customer_visible', true)
    .is('deleted_at', null)
    .limit(40);
  if (error) throw error;
  const cityAliases = journey.city.aliases;
  const candidates = (catalog || []).filter((item: any) => {
    const place = `${item.city || ''} ${item.location || ''}`.toLowerCase();
    return cityAliases.some((alias: string) => place.includes(alias));
  });
  const offers: Array<{ title: string; total: number; currency: string; note: string }> = [];
  for (const item of candidates) {
    const { data: quote, error: quoteError } = await sb.rpc('pcs_booking_quote', {
      p_item: item.id,
      p_start: journey.range.start,
      p_end: journey.range.end,
    });
    const total = Number(quote?.total_before_extras || 0);
    if (quoteError || quote?.ok !== true || quote?.manual_required || !Number.isFinite(total) || total <= 0) continue;
    offers.push({ title: String(item.title), total, currency: String(quote.currency || item.currency || 'THB'), note: String(item.availability_note || '').trim() });
    if (offers.length === 3) break;
  }
  if (!offers.length) {
    return {
      answer: `Приняли запрос: ${journey.city.label}, ${journey.range.start} — ${journey.range.end}. Проверим фактическую доступность автомобилей и вернёмся с предложением.`,
      provider: 'deterministic',
      model: 'car-rental-catalog-v1',
      confidence: 1,
      knowledgeIds: [],
      autoSend: !!settings?.auto_send,
      intent: 'car_rent',
    };
  }
  const formatted = offers.map((offer, index) => `${index + 1}. ${offer.title}\n${new Intl.NumberFormat('ru-RU').format(offer.total)} ${offer.currency}${offer.note ? `\n${offer.note}` : ''}`).join('\n\n');
  return {
    answer: `Нашли варианты на ${journey.range.start} — ${journey.range.end} в ${journey.city.label}:\n\n${formatted}\n\nНапишите название подходящего автомобиля — перед оформлением повторно подтвердим наличие и финальные условия.`,
    provider: 'deterministic',
    model: 'car-rental-catalog-v1',
    confidence: 1,
    knowledgeIds: [],
    autoSend: !!settings?.auto_send,
    intent: 'car_rent',
  };
}

async function createTask(contactId: string, title: string, comment: string) {
  const now = new Date().toISOString();
  const { data: existing } = await sb.from('pcs_tasks').select('id').eq('contact_id', contactId).eq('title', title).is('completed_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing?.id) {
    await sb.from('pcs_tasks').update({ comment, priority: 'HIGH', due_at: now, updated_at: now }).eq('id', existing.id);
    return;
  }
  const inserted = await sb.from('pcs_tasks').insert({ contact_id: contactId, title, comment, priority: 'HIGH', due_at: now });
  if (inserted.error?.code === '23505') {
    const { data: raced } = await sb.from('pcs_tasks').select('id').eq('contact_id', contactId).eq('title', title).is('completed_at', null).limit(1).maybeSingle();
    if (raced?.id) await sb.from('pcs_tasks').update({ comment, priority: 'HIGH', due_at: now, updated_at: now }).eq('id', raced.id);
    return;
  }
  if (inserted.error) throw inserted.error;
}

async function setConversationState(contactId: string, status: string, nextAction: string) {
  await sb.from('pcs_contacts')
    .update({ status, next_action: nextAction })
    .eq('id', contactId)
    .in('status', ['NEW', 'QUALIFYING', 'WAITING_CLIENT', 'IN_PROGRESS', 'OFFER_SENT']);
}

async function dispatch(channel: string, contactId: string, text: string) {
  const internal = await secret('internal_retry_secret');
  if (!internal) throw new Error('internal_retry_secret_missing');
  const response = await fetch(META_SEND, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pcs-internal-secret': internal }, body: JSON.stringify({ channel, contact_id: contactId, text }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `channel_send_${response.status}`);
  return payload;
}

async function processInbound(channel: string, row: any) {
  const { data: connection } = await sb.from('pcs_channel_connections').select('*').eq('channel', channel).maybeSingle();
  if (channel === 'instagram') {
    const transport = String(connection?.public_config?.transport || 'meta');
    const accountId = String(connection?.public_config?.instagram_account_id || '');
    if (transport !== 'bothelp' && !accountId) throw new Error('instagram_account_not_configured');
    if (transport !== 'bothelp' && row.account && row.account !== accountId) throw new Error('instagram_recipient_mismatch');
  }
  const saved = await ingest(channel, row);
  if (!shouldGenerateCustomerReply(channel, saved)) return { duplicate: !saved };
  const generated = await structuredCarRentalReply(saved.contact.id, row.text) || await generate(saved.contact.id, saved.messageId, row.text, saved.language);
  const risk = humanRisk(row.text, saved.contact.intent || null, row.kind);
  const replyMode = String(connection?.public_config?.reply_mode || 'draft');
  const providerUnavailable = generated.model === 'safe-fallback';
  const canAutoSend = Boolean(connection?.enabled && connection?.status === 'active' && replyMode === 'auto' && generated.autoSend && !risk && !providerUnavailable);
  const generation: any = {
    contact_id: saved.contact.id,
    source_message_id: saved.messageId,
    provider: generated.provider,
    model: generated.model,
    intent: saved.contact.intent || null,
    confidence: generated.confidence,
    risk: risk ? 'high' : 'low',
    requires_human: !canAutoSend,
    answer: generated.answer,
    next_action: canAutoSend ? 'Ответить автоматически' : 'Проверить и отправить ответ',
    knowledge_item_ids: generated.knowledgeIds,
    policy_decision: canAutoSend ? 'auto' : 'approval',
    policy_reason: risk || (replyMode !== 'auto' ? 'channel_draft_mode' : !generated.autoSend ? 'global_auto_send_off' : providerUnavailable ? 'ai_provider_unavailable' : 'channel_not_active'),
    status: canAutoSend ? 'sending' : 'approval_required',
    business_connection_id: channel,
    source_text: row.text,
  };
  const { data: record, error } = await sb.from('pcs_ai_generations').insert(generation).select('*').single();
  if (error) throw error;
  if (!canAutoSend) {
    const channelLabel = channel === 'line' ? 'LINE' : channel === 'whatsapp' ? 'WhatsApp' : channel === 'facebook' ? 'Facebook' : 'Instagram';
    const taskTitle = risk ? `${channelLabel}: требуется оператор` : `Проверить ответ ${channelLabel}`;
    await Promise.all([
      createTask(saved.contact.id, taskTitle, `${row.text}\n\nЧерновик:\n${generated.answer}`),
      setConversationState(saved.contact.id, 'IN_PROGRESS', `Проверить и отправить черновик ${channelLabel}`),
    ]);
    return { action: 'approval_required', contact_id: saved.contact.id, generation_id: record.id };
  }
  try {
    await dispatch(channel, saved.contact.id, generated.answer);
    await Promise.all([
      sb.from('pcs_ai_generations').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', record.id),
      setConversationState(saved.contact.id, 'WAITING_CLIENT', 'Дождаться ответа клиента'),
    ]);
    return { action: 'sent', contact_id: saved.contact.id, generation_id: record.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sb.from('pcs_ai_generations').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', record.id);
    await sb.from('pcs_failed_jobs').insert({ operation: `${channel}_send`, payload: { generation_id: record.id, contact_id: saved.contact.id }, error: message, contact_id: saved.contact.id, next_retry_at: new Date(Date.now() + 60_000).toISOString() });
    await createTask(saved.contact.id, `${channel.toUpperCase()}: ответ не отправлен`, message);
    throw error;
  }
}

async function processEvent(channel: string, eventId: string, eventRowId: string, body: any) {
  try {
  const rows = body?.__pcs_transport === 'bothelp' ? parseBotHelpPayload(body) : channel === 'whatsapp' ? parseWhatsApp(body) : channel === 'line' ? parseLine(body) : parseMessenger(body, channel);
    if (!rows.length) throw new Error('message_payload_missing');
    const results = [];
    for (const row of rows) {
      if (!row.message_id) row.message_id = eventId;
    results.push(await processInbound(channel, row));
    }
    await sb.from('pcs_channel_events').update({ status: 'processed', processed_at: new Date().toISOString(), error: null, payload: { source: body?.__pcs_transport || 'meta', results } }).eq('id', eventRowId);
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sb.from('pcs_channel_events').update({ status: 'failed', error: message.slice(0, 1000), processed_at: new Date().toISOString() }).eq('id', eventRowId);
    console.error('meta_event_failed', channel, eventId, message);
    throw error;
  }
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname.includes('/bothelp-admin')) return handleBotHelpAdmin(request, url);
  const channel = String(url.searchParams.get('channel') || '').toLowerCase();
  if (!CHANNELS.has(channel)) return json({ error: 'channel_required' }, 400);
  if (request.method === 'GET') {
    const expected = await secret(`channel_${channel}_verify_token`).catch(() => '');
    const supplied = url.searchParams.get('hub.verify_token') || '';
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && safeEqual(supplied, expected)) return new Response(url.searchParams.get('hub.challenge') || '', { status: 200, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const botHelp = channel === 'instagram' && String(url.searchParams.get('source') || '').toLowerCase() === 'bothelp';
  if (botHelp) {
    const expectedSecret = await secret('channel_instagram_bothelp_webhook_secret').catch(() => '');
    const suppliedSecret = String(request.headers.get('x-pcs-bothelp-secret') || '');
    if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) return json({ error: 'invalid_bothelp_secret' }, 401);
  } else {
    const appSecret = await secret(`channel_${channel}_app_secret`).catch(() => '');
    if (!appSecret) return json({ error: 'app_secret_not_configured' }, 503);
    const supplied = String(request.headers.get('x-hub-signature-256') || '').replace(/^sha256=/i, '').toLowerCase();
    const expected = await hmacSha256(appSecret, bytes);
    if (!supplied || !safeEqual(supplied, expected)) return json({ error: 'invalid_signature' }, 401);
  }
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'invalid_json' }, 400); }
  if (botHelp) body.__pcs_transport = 'bothelp';
  const eventId = (botHelp ? 'bothelp:' : '') + await sha256(bytes);
  const inserted = await sb.from('pcs_channel_events').insert({
    channel,
    external_event_id: eventId,
    payload: { object: String(body?.object || ''), entry_count: Array.isArray(body?.entry) ? body.entry.length : 0 },
    status: 'processing',
  }).select('id').single();
  if (inserted.error) {
    if (inserted.error.code === '23505') return json({ ok: true, duplicate: true });
    return json({ ok: false, error: 'event_store_failed' }, 500);
  }
  const job = processEvent(channel, eventId, inserted.data.id, body);
  if (botHelp) {
    try { return json({ ok: true, accepted: true, results: await job }); }
    catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500); }
  }
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(job);
  else await job;
  return json({ ok: true, accepted: true });
});
