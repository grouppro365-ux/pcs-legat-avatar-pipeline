async function bridgeRequest(url, token, payload) {
  if (!url) throw new Error('Secondary bridge URL is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Secondary bridge ${response.status}: ${text}`);
  return data;
}

export async function publishTenChat(payload) {
  return bridgeRequest(
    process.env.TENCHAT_BRIDGE_URL,
    process.env.TENCHAT_BRIDGE_TOKEN,
    { channel: 'tenchat', ...payload }
  );
}

export async function publishExternal(channel, payload) {
  const base = process.env.SECONDARY_PUBLISHER_URL;
  const token = process.env.SECONDARY_PUBLISHER_TOKEN;
  return bridgeRequest(base, token, { channel, ...payload });
}
