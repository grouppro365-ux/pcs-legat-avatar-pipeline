const MAX_SOURCE_CHARS = 40000;

function assertLegatUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (host !== 'legat-abc.com' && !host.endsWith('.legat-abc.com')) {
    throw new Error('Only legat-abc.com source URLs are allowed by this reader');
  }
  return url;
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
  const url = assertLegatUrl(rawUrl);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'AgencySocialPublisher/0.2 (+Legat ABC content source reader)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Legat source returned ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Unsupported Legat source content type: ${contentType}`);
  }
  const html = await response.text();
  const text = htmlToText(html).slice(0, MAX_SOURCE_CHARS);
  return {
    url: response.url || url.toString(),
    text,
    truncated: text.length >= MAX_SOURCE_CHARS,
  };
}

export async function importMediaFromUrl(rawUrl, uploadBuffer) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https media URLs are allowed');
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Media source returned ${response.status}`);
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
    throw new Error(`Unsupported media type: ${mimeType}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 100 * 1024 * 1024) throw new Error('Media exceeds 100 MB limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 100 * 1024 * 1024) throw new Error('Media exceeds 100 MB limit');
  const pathname = new URL(response.url || rawUrl).pathname;
  const filename = pathname.split('/').filter(Boolean).pop() || `media-${Date.now()}`;
  return uploadBuffer(buffer, filename, mimeType);
}
