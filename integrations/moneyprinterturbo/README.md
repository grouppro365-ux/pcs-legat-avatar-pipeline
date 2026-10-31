# MoneyPrinterTurbo for PCS / Legat — optional video generator

This directory is an **isolated deployment adapter**, not an active deployment.
It does not change the existing Kaggle avatar workflow, any PCS client data, or auto-publish to social media.

Original project: https://github.com/harry0703/MoneyPrinterTurbo
Official deployment source: https://github.com/harry0703/MoneyPrinterTurbo/blob/main/docker-compose.release.yml

## Server requirements
Linux host with Docker Engine and Compose v2, at least 4 CPU cores and 4 GB RAM (8 GB RAM recommended), internet access to pull the public image and assets. GPU optional. No server is included with this GitHub repository. Video generation may involve extra API/provider costs, depending on selected services.

## Installation
On the **server** (not in GitHub Actions, ChatGPT's temporary sandbox, or a local Android phone):
```bash
cd integrations/moneyprinterturbo
bash start.sh
```

The script downloads the official `config.example.toml` to `config.toml` on first start. The configuration and outputs are ignored by Git.

The service listens **only on localhost**:
- WebUI: http://127.0.0.1:8501
- API docs: http://127.0.0.1:8080/docs

For a remote server, access through an SSH tunnel, e.g. `ssh -L 8501:127.0.0.1:8501 user@server` and browse to http://127.0.0.1:8501. Do **not** directly publish 8501/8080 onto the internet without authentication and TLS.

## First video test
1. In WebUI choose a supported LLM and supply the provider API key; do not commit credentials.
2. Select a licensed footage provider (e.g. Pexels with your own API key), or use your own footage.
3. Choose RU or EN script, 9:16 1080x1920, and a voice.
4. Generate one short test **without auto-publishing**.
5. Review accuracy, footage licenses, audio/subtitles, and branding before manual posting.

Suggested example scripts for testing:
- PCS Thailand: "Что проверить перед арендой квартиры на Джомтьене?"
- Legat Thailand Car: "Пять вопросов перед арендой автомобиля в Паттайе"

## Managing the service
```bash
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 webui
docker compose -f docker-compose.yml down
```

## Operational notes
- Source `latest` is a moving upstream image. For stable production, pin to a reviewed image digest.
- No API keys, portrait photos, client data or car photos are included.
- This installation adapter does **not** mean the app is deployed. Verify on a persistent server and only then connect NAVI or other production automation.
- Use only footage with suitable commercial rights; no automatic posting is configured.
