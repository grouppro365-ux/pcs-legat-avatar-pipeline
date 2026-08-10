# Legat ABC Social Media — deployment source

This directory exists only on branch `agent/legat-abc-social-media-plugin`; the repository `main` branch is untouched.

## Vercel

Use this directory as the Vercel Root Directory. The build script reconstructs the verified runtime bundle, validates SHA-256, and runs `next build`.

Required server environment variables:
- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `OAUTH_SIGNING_SECRET`
- `APP_ENCRYPTION_KEY`

Optional:
- `CRON_SECRET` for scheduled publishing endpoint protection
- `APP_BASE_URL` if the canonical URL must be forced
- `GRAPH_API_VERSION`
- `VK_API_VERSION`

Never commit real values for these variables.

After deployment, the MCP endpoint is `https://<deployment-domain>/mcp` and OAuth discovery is available under `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`.
