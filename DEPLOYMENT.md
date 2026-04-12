# Public Launch Guide

This project is designed to run as one public WhatsApp AI number for all users.

## Architecture

- Meta WhatsApp Cloud API receives and sends WhatsApp messages
- Railway runs the backend and webhook
- NVIDIA hosts the main model
- GitHub stores the code and drives deployment
- Vercel is optional for a landing page or admin UI

## Launch Order

1. Create a GitHub repository for this code
2. Deploy the repo to Railway
3. Add Railway environment variables
4. Copy the public Railway URL
5. Create the Meta WhatsApp app and business setup
6. Configure the Meta webhook to point to Railway
7. Test with a single live number
8. Publish the public number and optional `wa.me` link

## Required Railway Environment Variables

- `PORT=3000`
- `TIMEZONE=Asia/Calcutta`
- `CLAW_DATA_DIR=./data`
- `NVIDIA_API_KEY=...`
- `NVIDIA_MODEL=mistralai/mistral-large-3-675b-instruct-2512`
- `NVIDIA_API_BASE=https://integrate.api.nvidia.com/v1`
- `WHATSAPP_VERIFY_TOKEN=...`
- `WHATSAPP_ACCESS_TOKEN=...`
- `WHATSAPP_PHONE_NUMBER_ID=...`
- `WHATSAPP_BUSINESS_ACCOUNT_ID=...`
- `WHATSAPP_GRAPH_VERSION=v22.0`
- `WHATSAPP_APP_SECRET=...`
- `BOT_NAME=Claw Cloud`
- `REMINDER_POLL_INTERVAL_MS=15000`
- `MAX_CONVERSATION_MESSAGES=40`

## Railway Health Endpoints

- `/health`: process is alive
- `/ready`: required production variables are present

## Meta Values We Need Back From Setup

Paste these values back into the project or Railway:

- WhatsApp access token
- WhatsApp phone number ID
- WhatsApp verify token
- WhatsApp app secret
- Public bot phone number

## Public Sharing

After the bot is live, users can reach it through:

- the public phone number
- a `wa.me/<number>` link
- a QR code that opens the `wa.me` link
- a website button

## Operator Checklist

- Confirm `npm test` passes
- Confirm `/health` returns `200`
- Confirm `/ready` returns `200`
- Confirm `npm run doctor:meta` can see the configured WhatsApp phone number ID
- Confirm `npm run doctor:public` passes before sharing the number globally
- Confirm Meta webhook verification succeeds
- Confirm one inbound test message receives one reply
- Confirm no duplicate send occurs for repeated webhook delivery
