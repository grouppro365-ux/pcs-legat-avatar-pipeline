# Agency Social Publisher v0.2.0

A unified Legat ABC social-media operating layer built on **Postiz + OpenAI + MCP**.

The goal is one command surface for:

- reading current Legat ABC listing/category pages;
- creating channel-native copy instead of one duplicated text;
- generating images;
- generating short AI videos;
- rendering deterministic Reels from real listing photos with FFmpeg;
- using existing images/videos without generation;
- creating drafts;
- scheduling and publishing;
- collecting Postiz analytics;
- routing Dzen and TenChat through explicitly configured bridges.

## Architecture

```text
ChatGPT / Codex
      │
      │ MCP /mcp
      ▼
Agency Social Publisher
      ├── Legat ABC fact + editorial rules
      ├── GPT-5.6 Terra text planning
      ├── GPT Image 2 generation
      ├── OpenAI video generation
      ├── FFmpeg real-photo Reels
      ├── existing-media import
      ├── Postiz adapter
      ├── Dzen Telegram-source route
      └── TenChat secondary bridge
                     │
                     ▼
                   Postiz
                     │
      Instagram / Facebook / Telegram / VK /
      TikTok / YouTube / Threads / LinkedIn / etc.
```

Postiz remains the social account/OAuth/scheduling layer. This service does **not** store social-network passwords, OTPs, cookies or recovery codes.

## What the MCP exposes

Read/planning tools:

- `list_social_accounts`
- `get_social_account_settings`
- `read_legat_listing`
- `plan_legat_social_content`
- `get_social_video_status`
- `get_social_post_analytics`
- `get_social_platform_analytics`

Creative/media tools:

- `generate_social_image`
- `start_social_video_generation`
- `finish_social_video_to_media`
- `render_reel_from_real_photos`
- `import_social_media_from_url`

Publishing tools:

- `create_social_draft`
- `schedule_social_post`
- `publish_social_post_now`
- `publish_channel_pack`
- `publish_dzen_source_via_telegram`
- `publish_tenchat_via_bridge`
- `publish_external_channel`

`publish_channel_pack` exists specifically so Instagram, Facebook, Telegram and VK can receive different native copy instead of one copy-pasted post.

## Safety / fact behavior

The Legat skill is intentionally conservative about commercial facts.

It must not invent:

- price or currency;
- availability;
- model/year/mileage/area;
- location;
- partner terms;
- legal status;
- ratings/reviews/statistics;
- guarantees of transaction safety.

For current Legat ABC listing facts, use `read_legat_listing` / `sourceUrl` first when possible.

Default workflow for new or variable commercial information:

```text
source/facts → plan → media → draft → review → schedule/publish → analytics
```

## Three media routes

### 1. AI image/video

Use this for editorial concepts, generic b-roll and other scenes where generation is appropriate.

### 2. Deterministic real-photo Reel

Use `render_reel_from_real_photos` for a concrete listing whose actual appearance must stay unchanged.

The renderer:

- accepts 1–8 allowlisted real image URLs;
- creates a vertical MP4 using FFmpeg;
- applies mild camera movement/crop only;
- adds only the supplied factual title/subtitle/footer;
- does not AI-redraw the photographed object;
- uploads the result to Postiz media.

This route requires the Docker/runtime image because FFmpeg is installed there.

### 3. Existing media, no generation

Already-edited MP4s, real photos, partner assets and other approved media can be imported/uploaded and sent directly to Postiz.

## Dzen

Dzen is currently modeled as a **Telegram crossposting route**, not as a native Postiz provider.

The intended flow is:

```text
Agency Social Publisher
      ↓
Dedicated Telegram integration in Postiz
      ↓
Telegram → Dzen crossposting configuration
```

A successful Telegram source post does not by itself prove that Dzen published it. Dzen must be verified separately before reporting success.

## TenChat

TenChat remains a secondary publisher route until a confirmed native/provider API is integrated.

Configure:

```env
TENCHAT_BRIDGE_URL=
TENCHAT_BRIDGE_TOKEN=
```

The bridge may be an n8n workflow, supported scheduler integration or another explicitly configured publisher. Do not automate TenChat passwords or OTP entry.

## Environment

Copy `.env.example` to `.env`.

Minimum runtime configuration:

```env
PORT=8787
BRIDGE_SECRET=change-me
POSTIZ_API_URL=https://api.postiz.com
POSTIZ_API_KEY=
OPENAI_API_KEY=
```

Current generation defaults:

```env
OPENAI_TEXT_MODEL=gpt-5.6-terra
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_VIDEO_MODEL=sora-2
```

`OPENAI_VIDEO_MODEL` is deliberately configurable. The current Videos API still accepts Sora 2 while the current model catalog labels the Sora 2 family legacy.

Approved existing-media hosts must be explicit:

```env
MEDIA_ALLOWED_HOSTS=legat-abc.com
```

Add only asset hosts that are actually controlled/approved for social media use.

Do not commit real secrets.

## Run locally

```bash
npm install
npm start
```

For the deterministic Reel route, run the supplied Docker image or ensure FFmpeg + DejaVu fonts are installed on the host.

Health:

```bash
curl http://127.0.0.1:8787/health
```

MCP endpoint:

```text
POST /mcp
```

When `BRIDGE_SECRET` is configured, authenticate with either:

```text
Authorization: Bearer <BRIDGE_SECRET>
```

or the legacy bridge header:

```text
x-bridge-key: <BRIDGE_SECRET>
```

The static bearer secret is suitable for a private/dev deployment. Before exposing this as a broadly available public plugin with write actions, replace it with a production authentication flow appropriate to the deployment.

## ChatGPT plugin packaging

The repo contains:

```text
.codex-plugin/plugin.json
skills/legat-abc-social/SKILL.md
```

The remote MCP must first be deployed to stable HTTPS. Then register its `/mcp` URL in ChatGPT developer/plugin tooling, obtain the registered app/plugin identifier, and wire that deployed MCP into the plugin package.

Until the remote MCP URL exists and is registered, the package is source-complete but not yet a live connected ChatGPT plugin.

## Postiz setup

Connect social accounts inside Postiz using Postiz-supported authorization. Then verify them through:

```text
GET /api/integrations
```

or MCP tool:

```text
list_social_accounts
```

Before first schedule/live publish for a provider, inspect:

```text
get_social_account_settings
```

because individual networks may require provider-specific settings.

## Generation

Text: OpenAI Responses API, default `gpt-5.6-terra`.

Images: OpenAI Images API, default `gpt-image-2`.

Video: OpenAI Videos API, model controlled by `OPENAI_VIDEO_MODEL`.

Video generation is asynchronous: create the job, check its status, then download/upload the completed MP4 to Postiz.

## Verification status

Source-level syntax/config CI exists in `.github/workflows/agency-social-publisher.yml` and includes MCP initialization smoke coverage plus a Docker build to validate the FFmpeg runtime.

Do **not** call the system production-ready until all of the following have been tested with real credentials/accounts:

1. Postiz integration discovery;
2. a private draft;
3. image upload;
4. deterministic real-photo Reel render + Postiz upload;
5. provider-specific schedule settings;
6. one controlled live publication per target provider;
7. AI video generation → Postiz upload;
8. analytics retrieval;
9. Dzen crosspost verification;
10. TenChat secondary bridge verification;
11. remote HTTPS MCP connection from ChatGPT.
