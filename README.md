# Claw Cloud WhatsApp

A clean WhatsApp-only backend powered by one NVIDIA-hosted model. The model answers normal questions directly and uses thin tools only when it needs real actions or real data.

## What this build does

- Handles inbound WhatsApp webhook events
- Uses one NVIDIA model as the main brain
- Stores contacts, conversations, reminders, and dedupe state locally in JSON
- Auto-sends WhatsApp messages when the user asks
- Prevents duplicate processing and duplicate outbound sends
- Runs scheduled reminders in the background

## Project shape

- `src/server.js`: HTTP server and webhook routing
- `src/agent.js`: single-model orchestration
- `src/tools.js`: contact, history, reminder, and outbound message tools
- `src/nvidia.js`: NVIDIA OpenAI-compatible chat client
- `src/whatsapp.js`: WhatsApp Cloud API integration
- `src/store.js`: JSON persistence
- `src/reminders.js`: reminder poller
- `data/`: local state files

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `NVIDIA_API_KEY`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
3. Start the server:

```bash
npm start
```

## Webhook endpoints

- `GET /health`
- `GET /ready`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`

Use the webhook URL plus `WHATSAPP_VERIFY_TOKEN` in the Meta dashboard.

## Default model

This project defaults to:

`mistralai/mistral-large-3-675b-instruct-2512`

You can change it with `NVIDIA_MODEL` if you want to switch to `deepseek-ai/deepseek-v3.2` or another compatible NVIDIA-hosted model.

## Notes

- The app can start without WhatsApp credentials, but sending messages will fail until those env vars are configured.
- The app can start without `NVIDIA_API_KEY`, but model calls will fail until it is configured.
- Signature validation is enabled automatically when `WHATSAPP_APP_SECRET` is set.

## Readiness

Run:

```bash
npm run doctor
```

This prints which required env vars are still missing.

`GET /ready` returns:

- `200` when the required NVIDIA and WhatsApp settings are present
- `503` when required settings are still missing

## Deployment

This repo includes a simple `Dockerfile`, so you can deploy it cleanly on a single Node container host such as Railway.
