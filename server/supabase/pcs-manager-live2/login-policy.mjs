export class LoginError extends Error {
  constructor(message, status, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

export async function beginLogin(request, rpc) {
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new LoginError('Запрос слишком большой', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LoginError('Укажите пароль', 400);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new LoginError('Запрос слишком большой', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new LoginError('Некорректный запрос', 400); }
  if (!body || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new LoginError('Укажите корректный пароль', 400);
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0,256);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  let claim;
  try { claim = await rpc('pcs_claim_login_attempt', {p_ip_hash: hash}); } catch { throw new LoginError('Вход временно недоступен. Повторите позже.', 503); }
  if (claim?.allowed === false) throw new LoginError('Слишком много попыток. Повторите через 15 минут.', 429, Number(claim.retry_after || 900));
  if (claim?.allowed !== true || claim.attempt_id == null) throw new LoginError('Вход временно недоступен. Повторите позже.', 503);
  return {password: body.password, attemptId: claim.attempt_id};
}

export async function finishLogin(rpc, attemptId) {
  try { await rpc('pcs_finish_login_attempt', {p_attempt_id: attemptId}); } catch { throw new LoginError('Вход временно недоступен. Повторите позже.', 503); }
}

export async function verifyAdminToken(request, secret) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(header);
  if (!match || header.length > 4096 || !secret) return null;
  try {
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const decode = x => Uint8Array.from(atob(x.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(x.length/4)*4,'=')),c=>c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC',key,decode(match[2]),new TextEncoder().encode(match[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(match[1])));
    return payload?.role === 'admin' && Number.isFinite(payload.exp) && payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

