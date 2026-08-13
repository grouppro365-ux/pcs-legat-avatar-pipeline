# Agency Social Publisher v0.2.0

A unified Legat ABC social-media operating layer built on **Postiz + OpenAI + MCP**.

The goal is one command surface for:

- reading current Legat ABC listing/category pages;
- creating channel-native copy instead of one duplicated text;
- generating images;
- generating short Sora videos;
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
      ├── OpenAI text/image/video generation
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

Optional generation defaults:

```env
OPENAI_TEXT_MODEL=gpt-5.1
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_VIDEO_MODEL=sora-2
```

Do not commit real secrets.

## Run locally

```bash
npm install
npm start
```

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

## Existing media, no generation

The system is not generation-only.

Existing photos, partner-authorized media, edited MP4s, HyperFrames outputs and other approved assets can be imported into Postiz and then drafted/scheduled/published.

The MCP tool is:

```text
import_social_media_from_url
```

The REST upload route is:

```text
POST /api/media/upload
```

## Generation

Text: OpenAI Responses API.

Images: OpenAI Images API.

Video: OpenAI Videos API / Sora job flow.

Video generation is asynchronous: create the job, check its status, then download/upload the completed MP4 to Postiz.

## Verification status

Source-level syntax/config CI exists in `.github/workflows/agency-social-publisher.yml` and includes MCP initialization smoke coverage.

Do **not** call the system production-ready until all of the following have been tested with real credentials/accounts:

1. Postiz integration discovery;
2. a private draft;
3. image upload;
4. provider-specific schedule settings;
5. one controlled live publication per target provider;
6. Sora video generation → Postiz upload;
7. analytics retrieval;
8. Dzen crosspost verification;
9. TenChat secondary bridge verification;
10. remote HTTPS MCP connection from ChatGPT.
