# Claw Cloud WhatsApp

A professional WhatsApp-only backend powered by a ranked NVIDIA model stack. The bot answers normal questions directly, falls back across multiple strong models when one fails, and uses thin tools only when it needs real actions or live data.

## What this build does

- Handles inbound WhatsApp webhook events
- Uses a ranked NVIDIA model fallback chain instead of relying on a single model
- Stores contacts, conversations, reminders, and dedupe state locally in JSON
- Auto-sends WhatsApp messages when the user asks
- Prevents duplicate processing and duplicate outbound sends
- Runs scheduled reminders in the background
- Can sync Google Contacts into the bot's contact store
- Splits long answers into clean WhatsApp-sized chunks instead of cutting replies mid-sentence
- Can use Gemini with Google Search grounding for faster live answers while preserving the user's language

## Project shape

- `src/server.js`: HTTP server and webhook routing
- `src/agent.js`: orchestration, retry, and answer-quality guards
- `src/tools.js`: contact, history, reminder, and outbound message tools
- `src/google-contacts.js`: Google OAuth and Google Contacts sync
- `src/nvidia.js`: NVIDIA OpenAI-compatible chat client
- `src/whatsapp.js`: WhatsApp Cloud API integration
- `src/store.js`: JSON persistence
- `src/reminders.js`: reminder poller
- `data/`: local state files

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `NVIDIA_API_KEY`
   - `GEMINI_API_KEY` if you want faster live answers for recent updates and current events
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `ADMIN_API_TOKEN` if you want protected admin/integration routes
   - `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` if you want Google Contacts sync
3. Start the server:

```bash
npm start
```

## Webhook endpoints

- `GET /health`
- `GET /ready`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`
- `GET /integrations/google`
- `GET /integrations/google/status`
- `GET /integrations/google/connect`
- `GET /integrations/google/callback`
- `GET /integrations/google/sync`
- `POST /integrations/google/sync`

Use the webhook URL plus `WHATSAPP_VERIFY_TOKEN` in the Meta dashboard.

## Google Contacts sync

This backend can import your Google Contacts so the WhatsApp agent can resolve names like `Dii`, `Papa`, or `Maa` much more reliably.

Set these env vars:

- `ADMIN_API_TOKEN`
- `APP_BASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Optional:

- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CONTACTS_SCOPE`

Recommended Google redirect URI:

`https://your-domain.com/integrations/google/callback`

After deployment, open:

`https://your-domain.com/integrations/google?token=YOUR_ADMIN_API_TOKEN`

Then:

1. Click `Connect Google Contacts`
2. Authorize the Google account
3. The first sync will run automatically
4. Use `Run Contact Sync` any time you want a manual refresh

Notes:

- The Google integration is protected by `ADMIN_API_TOKEN`
- Contacts are imported into the same local contact store used by the WhatsApp tools
- Only contacts with phone numbers are imported for action-ready messaging

## Default NVIDIA model stack

The backend now keeps a ranked fallback list of strong NVIDIA-hosted models and automatically moves to the next model if one fails or behaves badly. The default stack is:

1. `qwen/qwen3.5-397b-a17b`
2. `meta/llama-3.1-405b-instruct`
3. `mistralai/mistral-large-3-675b-instruct-2512`
4. `meta/llama-3.3-70b-instruct`
5. `mistralai/mistral-medium-3-instruct`
6. `meta/llama-4-maverick-17b-128e-instruct`
7. `qwen/qwen3-next-80b-a3b-instruct`
8. `google/gemma-3-27b-it`
9. `deepseek-ai/deepseek-v3.2`
10. `qwen/qwen2.5-coder-32b-instruct`

You can override the whole list with `NVIDIA_MODELS` or set a preferred first model with `NVIDIA_MODEL`.

## Notes

- The app can start without WhatsApp credentials, but sending messages will fail until those env vars are configured.
- The app can start without `NVIDIA_API_KEY`, but model calls will fail until it is configured.
- Signature validation is enabled automatically when `WHATSAPP_APP_SECRET` is set.
- `WHATSAPP_BUSINESS_ACCOUNT_ID` is kept for diagnostics and future WABA management calls.

## Readiness

Run:

```bash
npm run doctor
```

This prints which required env vars are still missing.

Run:

```bash
npm run doctor:meta
```

This verifies that the Meta access token can see the configured WhatsApp phone number ID without printing the token.

Run:

```bash
npm run doctor:public
```

This fails unless the WhatsApp setup is ready for public use. It blocks Meta test numbers, temporary user tokens, and missing webhook signature secrets.

`GET /ready` returns:

- `200` when the required NVIDIA and WhatsApp settings are present
- `503` when required settings are still missing

## Deployment

This repo includes a simple `Dockerfile`, so you can deploy it cleanly on a single Node container host such as Railway.
