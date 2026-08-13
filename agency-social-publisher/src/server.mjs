import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import {
  listIntegrations,
  getIntegrationSettings,
  listPosts,
  createPost,
  deletePost,
  uploadBuffer,
  buildPostizPayload,
  platformAnalytics,
  postAnalytics,
} from './postiz.mjs';
import {
  generateText,
  generateImage,
  createVideo,
  getVideo,
  downloadVideo,
  waitForVideo,
} from './openai.mjs';
import { generateLegatPlan, loadLegatConfig } from './legat.mjs';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'agency-social-publisher', version: '0.1.0' });
});

app.use((req, res, next) => {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return next();
  const supplied = req.header('x-bridge-key');
  if (supplied !== secret) return res.status(401).json({ error: 'unauthorized' });
  next();
});

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/project', asyncRoute(async (_req, res) => {
  res.json(await loadLegatConfig());
}));

app.get('/api/integrations', asyncRoute(async (req, res) => {
  res.json(await listIntegrations(req.query.group));
}));

app.get('/api/integrations/:id/settings', asyncRoute(async (req, res) => {
  res.json(await getIntegrationSettings(req.params.id));
}));

app.get('/api/posts', asyncRoute(async (req, res) => {
  res.json(await listPosts(req.query));
}));

app.delete('/api/posts/:id', asyncRoute(async (req, res) => {
  res.json(await deletePost(req.params.id));
}));

app.get('/api/analytics/platform/:integrationId', asyncRoute(async (req, res) => {
  res.json(await platformAnalytics(req.params.integrationId, req.query.date));
}));

app.get('/api/analytics/post/:postId', asyncRoute(async (req, res) => {
  res.json(await postAnalytics(req.params.postId, req.query.date));
}));

app.post('/api/plan', asyncRoute(async (req, res) => {
  res.json(await generateLegatPlan(req.body));
}));

app.post('/api/generate/text', asyncRoute(async (req, res) => {
  const { prompt, instructions, model } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  res.json({ text: await generateText({ prompt, instructions, model }) });
}));

app.post('/api/generate/image', asyncRoute(async (req, res) => {
  const { prompt, size, quality, model, uploadToPostiz = false, filename = 'generated.png' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const image = await generateImage({ prompt, size, quality, model });
  if (uploadToPostiz) {
    const postiz = await uploadBuffer(image.buffer, filename, image.mimeType);
    return res.json({ generated: true, postiz });
  }
  res.json({ generated: true, mimeType: image.mimeType, filename, b64: image.buffer.toString('base64') });
}));

app.post('/api/generate/video', asyncRoute(async (req, res) => {
  const { prompt, seconds, size, model } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  res.status(202).json(await createVideo({ prompt, seconds, size, model }));
}));

app.get('/api/generate/video/:id', asyncRoute(async (req, res) => {
  res.json(await getVideo(req.params.id));
}));

app.post('/api/generate/video/:id/wait-and-upload', asyncRoute(async (req, res) => {
  await waitForVideo(req.params.id, {
    timeoutMs: Number(req.body?.timeoutMs || 15 * 60 * 1000),
    intervalMs: Number(req.body?.intervalMs || 5000),
  });
  const video = await downloadVideo(req.params.id);
  const postiz = await uploadBuffer(video.buffer, req.body?.filename || video.filename, video.mimeType);
  res.json({ generated: true, videoId: req.params.id, postiz });
}));

app.post('/api/media/upload', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  res.json(await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype));
}));

app.post('/api/publish', asyncRoute(async (req, res) => {
  const payload = await buildPostizPayload(req.body || {});
  res.json(await createPost(payload));
}));

app.post('/api/workflows/image-draft', asyncRoute(async (req, res) => {
  const {
    subject,
    facts = {},
    channels = ['instagram', 'facebook'],
    goal = 'traffic',
    language = 'auto',
    integrationIds = [],
    date,
    settingsByIntegration = {},
  } = req.body || {};

  if (!subject) return res.status(400).json({ error: 'subject is required' });
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!integrationIds.length) return res.status(400).json({ error: 'integrationIds is required' });

  const plan = await generateLegatPlan({ subject, facts, channels, goal, language, includeVisual: true, includeVideo: false });
  if (plan.fact_gaps?.length) {
    return res.status(409).json({ error: 'FACT_GAPS', fact_gaps: plan.fact_gaps, plan });
  }

  const image = await generateImage({ prompt: plan.visual_prompt });
  const uploaded = await uploadBuffer(image.buffer, 'legat-generated.png', image.mimeType);
  const media = [uploaded].map((x) => ({ id: x.id, path: x.path || x.url })).filter((x) => x.id && x.path);

  const fallbackContent = plan.channels?.instagram?.caption || plan.channels?.facebook?.text || plan.master_angle;
  const payload = await buildPostizPayload({
    type: 'draft',
    date,
    content: fallbackContent,
    media,
    integrationIds,
    settingsByIntegration,
    shortLink: true,
    tags: [],
  });
  const post = await createPost(payload);
  res.json({ plan, media: uploaded, post });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err?.message || 'internal_error' });
});

app.listen(port, () => {
  console.log(`Agency Social Publisher listening on :${port}`);
});
