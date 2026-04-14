# Claw Cloud WhatsApp

A professional WhatsApp-only backend powered by Gemini for live/general answers and a strict selected 10-model NVIDIA stack for technical, academic, tool, and retry paths.

## What this build does

- Handles inbound WhatsApp webhook events
- Uses only the selected 10 NVIDIA API models for model-stack answers
- Stores contacts, conversations, reminders, and dedupe state locally in JSON
- Auto-sends WhatsApp messages when the user asks
- Prevents duplicate processing and duplicate outbound sends
- Runs scheduled reminders in the background
- Can sync Google Contacts into the bot's contact store
- Splits long answers into clean WhatsApp-sized chunks instead of cutting replies mid-sentence
- Uses Gemini with Google Search grounding first for live, latest, and general answers while preserving the user's language
- Does not send canned fallback replies when providers fail; failed model routing is logged instead

## Project shape

- `src/server.js`: HTTP server and webhook routing
- `src/agent.js`: orchestration, retry, and answer-quality guards
- `src/tools.js`: contact, history, reminder, and outbound message tools
- `src/google-contacts.js`: Google OAuth and Google Contacts sync
- `src/nvidia.js`: NVIDIA OpenAI-compatible chat client
- `src/gemini.js`: Gemini live-answer client with Google Search grounding
- `src/whatsapp.js`: WhatsApp Cloud API integration
- `src/store.js`: JSON persistence
- `src/reminders.js`: reminder poller
- `data/`: local state files

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `NVIDIA_API_KEY`
   - `GEMINI_API_KEY` if you want faster live answers for recent updates and current events
   - Optional latency controls: `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `NVIDIA_TIMEOUT_MS`, `NVIDIA_MAX_ATTEMPTS`, `SEARCH_TIMEOUT_MS`, `REPLY_LATENCY_BUDGET_MS`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_PROVIDER=meta` for direct Meta sending, or `WHATSAPP_PROVIDER=aisensy` for AiSensy outbound sending
   - `AISENSY_API_KEY` and `AISENSY_CAMPAIGN_NAME` if using AiSensy outbound sending
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

## AiSensy Outbound Mode

Set `WHATSAPP_PROVIDER=aisensy` when the production number must send through AiSensy instead of direct Meta Cloud API.

Required variables:

- `AISENSY_API_KEY`
- `AISENSY_CAMPAIGN_NAME`
- `AISENSY_API_URL`, defaults to `https://backend.aisensy.com/campaign/t1/api/v2`

Important: AiSensy API Campaigns send approved-template messages. Create one live API Campaign in AiSensy with one body variable for the AI reply, for example:

`{{1}}`

The backend passes the AI answer as `templateParams[0]`. Incoming user messages still need a webhook source. AiSensy trial accounts may not expose incoming-message webhooks, so Meta webhook intake can remain enabled while AiSensy handles outbound delivery.

## AiSensy Flow Clean Reply Mode

Use this mode when you want AiSensy to send the AI answer as a normal Flow Builder text reply without a template prefix or suffix.

Required variable:

- `AISENSY_FLOW_TOKEN`
- Set `WHATSAPP_AUTO_REPLY=false` after the AiSensy Flow is connected, so the old Meta webhook path does not also send a template reply.

Flow Builder API Request:

- URL: `https://your-domain.com/integrations/aisensy/answer`
- Method: `POST`
- Header: `x-admin-token: <AISENSY_FLOW_TOKEN>`
- Header: `Content-Type: application/json`
- JSON body:

```json
{
  "from": "$phone",
  "profileName": "$name",
  "text": "$message"
}
```

Capture `answer` from the JSON response, then send a Flow Builder text message containing that captured value. In this mode the backend returns the AI answer but does not send a WhatsApp template campaign message itself.

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

The backend keeps a strict selected 10-model NVIDIA-hosted stack and automatically tries the next selected model if one fails or behaves badly. The default stack is:

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

You can override the selected stack with `NVIDIA_MODELS`. Only the first 10 unique configured models are used for answer routing.

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
