# Agency Social Publisher

Unified generation + publishing bridge built around **Postiz** for Legat ABC.

## What it is

Postiz remains the social account/authentication/scheduling layer. This service adds the missing editorial and generation layer:

- Legat ABC channel-native content planning;
- text generation;
- image generation;
- Sora video job creation and upload;
- upload of existing images/videos without generation;
- Postiz media upload;
- draft / schedule / publish calls;
- connected channel discovery;
- post and platform analytics;
- one API contract (`openapi.yaml`) for future ChatGPT/MCP/plugin wiring.

The service does **not** store social-network passwords. Social accounts are connected inside Postiz using the methods Postiz supports.

## Current route

```text
Legat ABC facts / user request
        ↓
Agency Social Publisher
        ├─ editorial plan
        ├─ text
        ├─ image generation
        ├─ Sora video generation
        └─ existing media upload
        ↓
Postiz
        ↓
Instagram / Facebook / Telegram / VK / TikTok / YouTube / other Postiz providers
```

## Dzen

Dzen is not treated as a native Postiz provider in this project. The practical route is a dedicated Telegram channel connected to Dzen crossposting. Postiz publishes to Telegram; Dzen receives the Telegram publication through its configured crossposting route. Final Dzen status must still be verified.

## TenChat

TenChat is not treated as a native Postiz provider yet. It remains `bridge_required`. The recommended secondary bridge is a supported scheduler integration such as SMMplanner. Do not emulate login or OTP inside this service.

## Install

```bash
cd agency-social-publisher
cp .env.example .env
npm install
npm start
```

Default port: `8787`.

## Required environment variables

```env
POSTIZ_API_KEY=...
OPENAI_API_KEY=...
BRIDGE_SECRET=...
```

`POSTIZ_API_URL` defaults to Postiz Cloud (`https://api.postiz.com`) but can point to a self-hosted Postiz API.

## Health

```bash
curl http://localhost:8787/health
```

## Connected channels

```bash
curl http://localhost:8787/api/integrations \
  -H "x-bridge-key: $BRIDGE_SECRET"
```

Use the returned integration IDs when scheduling/publishing.

## Create a Legat ABC social plan

```bash
curl -X POST http://localhost:8787/api/plan \
  -H "content-type: application/json" \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -d '{
    "subject":"MG MG5 Pro K-BRIT in Pattaya",
    "facts":{"year":2025,"mileage_km":6450,"location":"Pattaya"},
    "channels":["instagram","facebook","telegram","vk"],
    "goal":"traffic"
  }'
```

Missing facts must be surfaced as `fact_gaps`; the planner is instructed not to invent them.

## Generate an image and put it in Postiz media

```bash
curl -X POST http://localhost:8787/api/generate/image \
  -H "content-type: application/json" \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -d '{
    "prompt":"Light editorial Legat ABC car-of-the-week cover...",
    "size":"1024x1536",
    "quality":"high",
    "uploadToPostiz":true,
    "filename":"mg5-cover.png"
  }'
```

## Upload existing media without generation

```bash
curl -X POST http://localhost:8787/api/media/upload \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -F "file=@reel.mp4"
```

This is the non-generation route: real photos, partner media, HyperFrames output, edited MP4, etc.

## Generate Sora video

Create the job:

```bash
curl -X POST http://localhost:8787/api/generate/video \
  -H "content-type: application/json" \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -d '{
    "prompt":"Vertical editorial marketplace video...",
    "seconds":"8",
    "size":"720x1280"
  }'
```

Check status:

```bash
curl http://localhost:8787/api/generate/video/VIDEO_ID \
  -H "x-bridge-key: $BRIDGE_SECRET"
```

When ready, download it from OpenAI and upload directly to Postiz:

```bash
curl -X POST http://localhost:8787/api/generate/video/VIDEO_ID/wait-and-upload \
  -H "content-type: application/json" \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -d '{}'
```

## Draft / schedule / publish

The safest first mode is `draft`.

```bash
curl -X POST http://localhost:8787/api/publish \
  -H "content-type: application/json" \
  -H "x-bridge-key: $BRIDGE_SECRET" \
  -d '{
    "type":"draft",
    "date":"2026-08-14T09:00:00+07:00",
    "content":"Post text",
    "integrationIds":["POSTIZ_INTEGRATION_ID"],
    "media":[]
  }'
```

For scheduled/live posts, Postiz provider settings may be required. Inspect them with:

```bash
GET /api/integrations/{id}/settings
```

and pass provider-specific fields under `settingsByIntegration`.

## Combined workflow: plan → image → Postiz draft

`POST /api/workflows/image-draft`

This route refuses to create the draft when the planner reports unresolved `fact_gaps`.

## Operating rule

Start with:

`generate → QA → Postiz draft → approval → schedule/publish`

After the factual pipeline has been stable in production, low-risk content can be moved to direct scheduling.

High-risk/variable commercial facts (price, availability, legal/partner claims, exact conditions) should keep an approval gate.

## Security

- Never put passwords, OTP, cookies or recovery codes in this repository.
- Keep `POSTIZ_API_KEY`, `OPENAI_API_KEY` and `BRIDGE_SECRET` in environment variables / secret storage.
- Do not expose the bridge publicly without `BRIDGE_SECRET` or another authentication layer.
- OAuth/social authorization belongs to Postiz (or the explicitly configured secondary bridge), not to the Legat skill.

## Source architecture

The adapter follows Postiz's public endpoints used by its own SDK/agent:

- `GET /public/v1/integrations`
- `GET /public/v1/integration-settings/:id`
- `POST /public/v1/upload`
- `POST /public/v1/posts`
- post/platform analytics endpoints

The OpenAI generation layer uses the Responses API for text, the Images API for images, and the Videos API for Sora jobs.
