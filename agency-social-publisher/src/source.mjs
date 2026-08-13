const MAX_SOURCE_CHARS = 40000;
const MAX_REDIRECTS = 5;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function isLegatHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'legat-abc.com' || host.endsWith('.legat-abc.com');
}

function mediaAllowedHosts() {
  const configured = (process.env.MEDIA_ALLOWED_HOSTS || 'legat-abc.com')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured);
}

function matchesAllowedHost(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  for (const allowed of allowedHosts) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function assertHttpUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed');
  return url;
}

function assertLegatUrl(rawUrl) {
  const url = assertHttpUrl(rawUrl);
  if (!isLegatHost(url.hostname)) throw new Error('Only legat-abc.com source URLs are allowed by this reader');
  return url;
}

function assertAllowedMediaUrl(rawUrl) {
  const url = assertHttpUrl(rawUrl);
  const allowed = mediaAllowedHosts();
  if (!matchesAllowedHost(url.hostname, allowed)) {
    throw new Error(`Media host is not approved: ${url.hostname}. Configure MEDIA_ALLOWED_HOSTS explicitly.`);
  }
  return url;
}

async function fetchWithValidatedRedirects(startUrl, validateUrl, options = {}) {
  let url = validateUrl(startUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response did not include Location');
    if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects');
    url = validateUrl(new URL(location, url).toString());
  }
  throw new Error('Too many redirects');
}

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function readLegatSource(rawUrl) {
  const initial = assertLegatUrl(rawUrl);
  const response = await fetchWithValidatedRedirects(initial.toString(), assertLegatUrl, {
    headers: {
      'User-Agent': 'AgencySocialPublisher/0.2 (+Legat ABC content source reader)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Legat source returned ${response.status}`);
  const finalUrl = assertLegatUrl(response.url || initial.toString());
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Unsupported Legat source content type: ${contentType}`);
  }
  const html = await response.text();
  const normalized = htmlToText(html);
  const text = normalized.slice(0, MAX_SOURCE_CHARS);
  return {
    url: finalUrl.toString(),
    text,
    truncated: normalized.length > MAX_SOURCE_CHARS,
  };
}

export async function fetchApprovedMedia(rawUrl, { kind = 'any' } = {}) {
  const initial = assertAllowedMediaUrl(rawUrl);
  const response = await fetchWithValidatedRedirects(initial.toString(), assertAllowedMediaUrl);
  if (!response.ok) throw new Error(`Media source returned ${response.status}`);
  const finalUrl = assertAllowedMediaUrl(response.url || initial.toString());
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  const allowedMime =
    kind === 'image' ? mimeType.startsWith('image/') :
    kind === 'video' ? mimeType.startsWith('video/') :
    kind === 'audio' ? mimeType.startsWith('audio/') :
    mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/');
  if (!allowedMime) throw new Error(`Unsupported media type for ${kind}: ${mimeType}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_MEDIA_BYTES) throw new Error('Media exceeds 100 MB limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error('Media exceeds 100 MB limit');
  const pathname = finalUrl.pathname;
  const filename = pathname.split('/').filter(Boolean).pop() || `media-${Date.now()}`;
  return { buffer, filename, mimeType, url: finalUrl.toString() };
}

export async function importMediaFromUrl(rawUrl, uploadBuffer) {
  const media = await fetchApprovedMedia(rawUrl);
  return uploadBuffer(media.buffer, media.filename, media.mimeType);
}
