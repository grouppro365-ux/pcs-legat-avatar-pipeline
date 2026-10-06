const API_URL = process.env.POSTIZ_API_URL || 'https://api.postiz.com';

function authHeaders(extra = {}) {
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) throw new Error('POSTIZ_API_KEY is not configured');
  return { Authorization: apiKey, ...extra };
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    }),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    throw new Error(`Postiz ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

export async function listIntegrations(group) {
  const qs = group ? `?group=${encodeURIComponent(group)}` : '';
  return jsonRequest(`/public/v1/integrations${qs}`);
}

export async function getIntegrationSettings(id) {
  return jsonRequest(`/public/v1/integration-settings/${encodeURIComponent(id)}`);
}

export async function listPosts(filters = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  return jsonRequest(`/public/v1/posts${qs.size ? `?${qs}` : ''}`);
}

export async function createPost(payload) {
  return jsonRequest('/public/v1/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deletePost(id) {
  return jsonRequest(`/public/v1/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function uploadBuffer(buffer, filename, mimeType = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const response = await fetch(`${API_URL}/public/v1/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Postiz upload ${response.status}: ${text}`);
  return data;
}

export async function platformAnalytics(integrationId, date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return jsonRequest(`/public/v1/analytics/${encodeURIComponent(integrationId)}${qs}`);
}

export async function postAnalytics(postId, date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return jsonRequest(`/public/v1/analytics/post/${encodeURIComponent(postId)}${qs}`);
}

export function inferProviderType(integration) {
  return (
    integration?.identifier ||
    integration?.providerIdentifier ||
    integration?.provider ||
    integration?.type ||
    integration?.name ||
    ''
  ).toString().toLowerCase();
}

export async function buildPostizPayload({
  type = 'draft',
  date,
  content,
  media = [],
  integrationIds = [],
  settingsByIntegration = {},
  shortLink = true,
  tags = [],
}) {
  if (!date) throw new Error('date is required');
  if (!content) throw new Error('content is required');
  if (!integrationIds.length) throw new Error('integrationIds is required');

  const all = await listIntegrations();
  const integrations = Array.isArray(all) ? all : all?.integrations || all?.data || [];

  const posts = integrationIds.map((id) => {
    const integration = integrations.find((x) => x?.id === id);
    const override = settingsByIntegration[id] || {};
    const providerType = override.__type || inferProviderType(integration);

    if (type !== 'draft' && !providerType) {
      throw new Error(`Cannot infer provider type for integration ${id}. Pass settingsByIntegration[${id}].__type.`);
    }

    return {
      integration: { id },
      value: [{ content, image: media }],
      ...(type === 'draft' ? {} : { settings: { __type: providerType, ...override } }),
    };
  });

  return {
    type,
    date,
    shortLink,
    tags,
    posts,
  };
}
