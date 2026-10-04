# PCS persistent browser

Dedicated PCS deployment of the open-source AIO Sandbox browser with an authenticated gateway. It does not create a CRM or connect to another project's profile.

## Deployment

Requires a permanent Docker Compose host and a dedicated DNS hostname pointing to it. Docker is unavailable in the current work environment; the container deployment has not been verified here.

Copy `.env.example` to `.env`, generate two different private keys with `openssl rand -hex 32`, set `PCS_PROJECT_ID` to the PCS project UUID and `PCS_BROWSER_DOMAIN` to the dedicated hostname. Run `docker compose up -d --build`. Caddy terminates HTTPS. AIO is reachable only through the private Docker network.

The `project_data` volume retains `/home/gem/pcs/files` and `/home/gem/pcs/profile`. Back up this volume; do not use `docker compose down -v` when preserving the Telegram session.

The gateway implements context/session endpoints, temporary view links and restricted UTF-8 file operations. The owner must sign in to Telegram manually through a one-use login link. No Telegram session is connected yet. Provisioning alone does not enable prospect outreach or Follow-up.

## Local verification

`npm ci --ignore-scripts --no-audit --no-fund && npm test` verifies gateway authentication, project isolation, session locking and revocation, one-use login links, cookie protection and restricted file access against a mock upstream. It does not verify Docker, real Chromium or Telegram login.
