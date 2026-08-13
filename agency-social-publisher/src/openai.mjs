import OpenAI from 'openai';

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function generateText({ prompt, instructions = '', model }) {
  const openai = client();
  const response = await openai.responses.create({
    model: model || process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-terra',
    instructions: instructions || undefined,
    input: prompt,
  });
  return response.output_text;
}

export async function generateImage({ prompt, size = '1024x1536', quality = 'high', model }) {
  const openai = client();
  const result = await openai.images.generate({
    model: model || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    prompt,
    size,
    quality,
    output_format: 'png',
  });

  const item = result.data?.[0];
  if (!item) throw new Error('OpenAI image API returned no image');
  if (item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', filename: 'generated.png' };
  }
  if (item.url) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Failed to download generated image: ${response.status}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: 'image/png', filename: 'generated.png' };
  }
  throw new Error('OpenAI image API returned neither b64_json nor url');
}

async function openaiFetch(path, options = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text}`);
  }
  return response;
}

export async function createVideo({ prompt, seconds = '8', size = '720x1280', model }) {
  const form = new FormData();
  form.set('model', model || process.env.OPENAI_VIDEO_MODEL || 'sora-2');
  form.set('prompt', prompt);
  form.set('seconds', String(seconds));
  form.set('size', size);
  const response = await openaiFetch('/videos', { method: 'POST', body: form });
  return response.json();
}

export async function getVideo(videoId) {
  const response = await openaiFetch(`/videos/${encodeURIComponent(videoId)}`);
  return response.json();
}

export async function downloadVideo(videoId) {
  const response = await openaiFetch(`/videos/${encodeURIComponent(videoId)}/content`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') || 'video/mp4',
    filename: `${videoId}.mp4`,
  };
}
