#!/usr/bin/env bash
# Start the official MoneyPrinterTurbo image with local-only WebUI/API ports.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: install Docker Engine with Docker Compose plugin first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 is required." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to fetch the upstream config template." >&2
  exit 1
fi
if [[ ! -e config.toml ]]; then
  umask 077
  echo "Downloading the upstream default configuration (no keys added)."
  curl --fail --location --silent --show-error \
    https://raw.githubusercontent.com/harry0703/MoneyPrinterTurbo/main/config.example.toml \
    --output config.toml
fi
mkdir -p storage
chmod 600 config.toml
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml ps

echo "WebUI: http://127.0.0.1:8501"
echo "API docs: http://127.0.0.1:8080/docs"
echo "Configure an LLM and stock media source from WebUI. Do not expose the ports publicly."
