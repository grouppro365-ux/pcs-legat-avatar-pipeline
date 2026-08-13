import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import {
  listIntegrations,
  getIntegrationSettings,
  createPost,
  uploadBuffer,
  buildPostizPayload,
  postAnalytics,
  platformAnalytics,
} from './postiz.mjs';
import {
  generateImage,
  createVideo,
  getVideo,
  waitForVideo,
  downloadVideo,
} from './openai.mjs';
import { generateLegatPlan } from './legat.mjs';
import { readLegatSource, importMediaFromUrl } from './source.mjs';
import { publishTenChat, publishExternal } from './secondary.mjs';

const mediaSchema = z.object({
  id: z.string(),
  path: z.string(),
});

const settingsSchema = z.record(z.string(), z.any()).optional();

function result(data, message) {
  return {
    structuredContent: data,
    content: [{ type: 'text', text: message || JSON.stringify(data) }],
  };
}

function buildServer() {
  const server = new McpServer(
    { name: 'agency-social-publisher', version: '0.2.0' },
    {
      instructions:
        'Legat ABC social operations. Read source/facts before creating content. Never invent price, availability, model, mileage, location, partner terms or safety guarantees. Prefer drafts for new or variable commercial facts. Use schedule/publish tools only when the user has explicitly asked to publish or schedule.',
    }
  );

  server.registerTool(
    'list_social_accounts',
    {
      title: 'List connected social accounts',
      description: 'List social channels currently connected in Postiz and return their integration IDs. Call this before drafting or publishing when IDs are not already known.',
      inputSchema: z.object({ group: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ group }) => {
      const integrations = await listIntegrations(group);
      return result({ integrations }, 'Connected social integrations loaded.');
    }
  );

  server.registerTool(
    'get_social_account_settings',
    {
      title: 'Get social account publishing settings',
      description: 'Read provider-specific publishing requirements for one Postiz integration before scheduling or publishing.',
      inputSchema: z.object({ integrationId: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ integrationId }) => {
      const settings = await getIntegrationSettings(integrationId);
      return result({ integrationId, settings }, 'Provider publishing settings loaded.');
    }
  );

  server.registerTool(
    'read_legat_listing',
    {
      title: 'Read a Legat ABC listing',
      description: 'Read the current public text of a legat-abc.com listing/category page as source material. Use this instead of relying on old remembered listing facts.',
      inputSchema: z.object({ url: z.string().url() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ url }) => {
      const source = await readLegatSource(url);
      return result(source, `Read current Legat ABC source: ${source.url}`);
    }
  );

  server.registerTool(
    'plan_legat_social_content',
    {
      title: 'Plan Legat ABC social content',
      description: 'Create channel-native copy, hooks, CTA, visual prompt and video prompt from confirmed facts and optionally a current Legat ABC URL. Does not publish anything.',
      inputSchema: z.object({
        subject: z.string(),
        facts: z.record(z.string(), z.any()).optional(),
        sourceUrl: z.string().url().optional(),
        channels: z.array(z.enum(['instagram', 'facebook', 'telegram', 'vk', 'dzen', 'tenchat'])).optional(),
        goal: z.string().optional(),
        language: z.string().optional(),
        includeVisual: z.boolean().optional(),
        includeVideo: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ subject, facts = {}, sourceUrl, channels, goal, language, includeVisual = true, includeVideo = true }) => {
      let source = null;
      if (sourceUrl) source = await readLegatSource(sourceUrl);
      const mergedFacts = source
        ? { ...facts, source_url: source.url, source_text: source.text }
        : facts;
      const plan = await generateLegatPlan({
        subject,
        facts: mergedFacts,
        channels,
        goal,
        language,
        includeVisual,
        includeVideo,
      });
      return result({ plan, sourceUrl: source?.url || null }, plan.fact_gaps?.length ? 'Plan created, but factual gaps still need confirmation.' : 'Plan created from confirmed/source facts.');
    }
  );

  server.registerTool(
    'generate_social_image',
    {
      title: 'Generate a social image',
      description: 'Generate one social image using OpenAI and upload it to Postiz media. Returns a Postiz media reference that can be used in a draft or publication.',
      inputSchema: z.object({
        prompt: z.string(),
        size: z.string().optional(),
        quality: z.string().optional(),
        filename: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ prompt, size, quality, filename = 'legat-generated.png' }) => {
      const image = await generateImage({ prompt, size, quality });
      const media = await uploadBuffer(image.buffer, filename, image.mimeType);
      return result({ media }, 'Image generated and added to Postiz media.');
    }
  );

  server.registerTool(
    'start_social_video_generation',
    {
      title: 'Start social video generation',
      description: 'Start an OpenAI Sora video generation job. This creates a generation job but does not publish the result.',
      inputSchema: z.object({
        prompt: z.string(),
        seconds: z.enum(['4', '8', '12']).optional(),
        size: z.enum(['720x1280', '1280x720', '1024x1792', '1792x1024']).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ prompt, seconds = '8', size = '720x1280' }) => {
      const video = await createVideo({ prompt, seconds, size });
      return result({ video }, 'Video generation started.');
    }
  );

  server.registerTool(
    'get_social_video_status',
    {
      title: 'Get social video status',
      description: 'Check the status of a previously started OpenAI video job.',
      inputSchema: z.object({ videoId: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ videoId }) => {
      const video = await getVideo(videoId);
      return result({ video }, `Video status: ${video.status || 'unknown'}`);
    }
  );

  server.registerTool(
    'finish_social_video_to_media',
    {
      title: 'Finish video and add it to Postiz',
      description: 'Wait for an OpenAI video job to finish, download the MP4 and upload it to Postiz media. Does not publish the video.',
      inputSchema: z.object({
        videoId: z.string(),
        filename: z.string().optional(),
        timeoutMs: z.number().int().positive().max(900000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ videoId, filename, timeoutMs = 900000 }) => {
      await waitForVideo(videoId, { timeoutMs });
      const video = await downloadVideo(videoId);
      const media = await uploadBuffer(video.buffer, filename || video.filename, video.mimeType);
      return result({ videoId, media }, 'Generated video added to Postiz media.');
    }
  );

  server.registerTool(
    'import_social_media_from_url',
    {
      title: 'Import existing social media',
      description: 'Import an existing image, video or audio file from an http/https URL into Postiz media without generating anything.',
      inputSchema: z.object({ url: z.string().url() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ url }) => {
      const media = await importMediaFromUrl(url, uploadBuffer);
      return result({ media }, 'Existing media imported into Postiz.');
    }
  );

  const postInput = z.object({
    date: z.string(),
    content: z.string(),
    integrationIds: z.array(z.string()).min(1),
    media: z.array(mediaSchema).optional(),
    settingsByIntegration: z.record(z.string(), z.any()).optional(),
    shortLink: z.boolean().optional(),
  });

  server.registerTool(
    'create_social_draft',
    {
      title: 'Create social draft',
      description: 'Create a private Postiz draft for one or more connected channels. Use this as the default write action when content includes new or variable commercial facts.',
      inputSchema: postInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ date, content, integrationIds, media = [], settingsByIntegration = {}, shortLink = true }) => {
      const payload = await buildPostizPayload({ type: 'draft', date, content, integrationIds, media, settingsByIntegration, shortLink, tags: [] });
      const post = await createPost(payload);
      return result({ post }, 'Postiz draft created. It has not been published.');
    }
  );

  server.registerTool(
    'schedule_social_post',
    {
      title: 'Schedule social post',
      description: 'Schedule a post on one or more connected social channels. This is an external write action; use only when the user asked to schedule/publish.',
      inputSchema: postInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ date, content, integrationIds, media = [], settingsByIntegration = {}, shortLink = true }) => {
      const payload = await buildPostizPayload({ type: 'schedule', date, content, integrationIds, media, settingsByIntegration, shortLink, tags: [] });
      const post = await createPost(payload);
      return result({ post }, 'Social post scheduled through Postiz.');
    }
  );

  server.registerTool(
    'publish_social_post_now',
    {
      title: 'Publish social post now',
      description: 'Publish a post immediately to one or more connected social channels. Consequential public write action; call only after explicit user intent to publish now.',
      inputSchema: postInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ date, content, integrationIds, media = [], settingsByIntegration = {}, shortLink = true }) => {
      const payload = await buildPostizPayload({ type: 'now', date, content, integrationIds, media, settingsByIntegration, shortLink, tags: [] });
      const post = await createPost(payload);
      return result({ post }, 'Immediate publication request sent through Postiz. Verify the resulting platform post/release before reporting it as published.');
    }
  );

  server.registerTool(
    'publish_channel_pack',
    {
      title: 'Publish channel-native content pack',
      description: 'Create separate channel-native drafts/schedules/publications so Instagram, Facebook, Telegram, VK and other integrations can use different copy instead of one duplicated text.',
      inputSchema: z.object({
        items: z.array(z.object({
          type: z.enum(['draft', 'schedule', 'now']).default('draft'),
          date: z.string(),
          content: z.string(),
          integrationId: z.string(),
          media: z.array(mediaSchema).optional(),
          settings: settingsSchema,
          shortLink: z.boolean().optional(),
        })).min(1).max(30),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ items }) => {
      const results = [];
      for (const item of items) {
        const settingsByIntegration = item.settings ? { [item.integrationId]: item.settings } : {};
        const payload = await buildPostizPayload({
          type: item.type,
          date: item.date,
          content: item.content,
          integrationIds: [item.integrationId],
          media: item.media || [],
          settingsByIntegration,
          shortLink: item.shortLink ?? true,
          tags: [],
        });
        results.push({ integrationId: item.integrationId, type: item.type, result: await createPost(payload) });
      }
      return result({ results }, `Processed ${results.length} channel-native Postiz item(s).`);
    }
  );

  server.registerTool(
    'publish_dzen_source_via_telegram',
    {
      title: 'Publish Dzen source through Telegram',
      description: 'Publish or schedule a post to the dedicated Telegram integration that is configured as the Dzen crossposting source. This confirms the Telegram source post only; Dzen appearance must be checked separately.',
      inputSchema: z.object({
        type: z.enum(['draft', 'schedule', 'now']).default('draft'),
        date: z.string(),
        content: z.string(),
        telegramIntegrationId: z.string(),
        media: z.array(mediaSchema).optional(),
        settings: settingsSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ type, date, content, telegramIntegrationId, media = [], settings = {} }) => {
      const payload = await buildPostizPayload({
        type,
        date,
        content,
        integrationIds: [telegramIntegrationId],
        media,
        settingsByIntegration: { [telegramIntegrationId]: settings },
        shortLink: true,
        tags: [],
      });
      const post = await createPost(payload);
      return result({ post, dzenStatus: 'not_verified' }, 'Telegram source item processed. Dzen crosspost is not yet verified.');
    }
  );

  server.registerTool(
    'publish_tenchat_via_bridge',
    {
      title: 'Publish to TenChat through configured bridge',
      description: 'Send a TenChat publication request through the configured secondary publisher bridge. Requires TENCHAT_BRIDGE_URL on the server.',
      inputSchema: z.object({
        content: z.string(),
        date: z.string().optional(),
        media: z.array(z.record(z.string(), z.any())).optional(),
        mode: z.enum(['draft', 'schedule', 'now']).default('draft'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (payload) => {
      if (!process.env.TENCHAT_BRIDGE_URL) throw new Error('TENCHAT_BRIDGE_URL is not configured');
      const response = await publishTenChat(payload);
      return result({ response }, 'TenChat request sent to the configured secondary bridge.');
    }
  );

  server.registerTool(
    'publish_external_channel',
    {
      title: 'Publish through secondary channel bridge',
      description: 'Send a publishing request to a configured secondary bridge for a channel not handled by Postiz. Use only for explicitly configured channels.',
      inputSchema: z.object({
        channel: z.string(),
        payload: z.record(z.string(), z.any()),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ channel, payload }) => {
      if (!process.env.SECONDARY_PUBLISHER_URL) throw new Error('SECONDARY_PUBLISHER_URL is not configured');
      const response = await publishExternal(channel, payload);
      return result({ response }, `Secondary publisher request sent for ${channel}.`);
    }
  );

  server.registerTool(
    'get_social_post_analytics',
    {
      title: 'Get social post analytics',
      description: 'Read analytics for one Postiz post.',
      inputSchema: z.object({ postId: z.string(), date: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ postId, date }) => {
      const analytics = await postAnalytics(postId, date);
      return result({ postId, analytics }, 'Post analytics loaded.');
    }
  );

  server.registerTool(
    'get_social_platform_analytics',
    {
      title: 'Get social platform analytics',
      description: 'Read analytics for one connected Postiz social integration.',
      inputSchema: z.object({ integrationId: z.string(), date: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ integrationId, date }) => {
      const analytics = await platformAnalytics(integrationId, date);
      return result({ integrationId, analytics }, 'Platform analytics loaded.');
    }
  );

  return server;
}

export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    const server = buildServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP error', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error?.message || 'MCP internal error' },
          id: null,
        });
      }
    }
  });
}
