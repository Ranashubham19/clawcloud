# SwiftDeploy SaaS for Coaching Institutes

Multi-tenant WhatsApp AI SaaS for coaching institutes. This build keeps the existing WhatsApp bot core and adds institute workspaces, operator auth, lead capture, demo booking, billing hooks, and a browser dashboard.

## What this build does

- Receives inbound WhatsApp messages through a provider-normalized webhook layer
- Answers images, voice recordings, audio, video, PDFs, text files, CSV/JSON, and modern Office files from WhatsApp and Telegram
- Resolves the correct institute by business id, WhatsApp number mapping, or unambiguous provider routing
- Uses institute-specific AI prompts, FAQs, courses, and welcome copy
- Captures leads with name, phone, course interest, and preferred timing
- Stores demo booking requests and operator-created bookings
- Serves a SaaS dashboard with auth, leads, chats, bookings, billing, and settings
- Adds Stripe checkout, billing portal, and webhook handling
- Adds security headers, origin checks, session cookies, and rate limiting
- Keeps Meta and AiSensy integrations intact behind one messaging abstraction so switching providers is a config change

## Architecture

- `public/`: landing page and operator dashboard
- `src/server.js`: HTTP server, webhooks, SaaS routes, legal pages
- `src/saas-routes.js`: auth, dashboard API, business CRUD, billing endpoints
- `src/saas-store.js`: SaaS users, businesses, leads, bookings, sessions, billing metadata
- `src/saas.js`: institute prompt building, lead extraction, dashboard aggregation, readiness scoring
- `src/security.js`: CSP headers, origin validation, rate limiting, Stripe signature verification
- `src/billing.js`: Stripe checkout session, portal session, webhook sync
- `src/agent.js`: AI orchestration and business-aware reply generation
- `src/messaging.js`: provider-agnostic messaging orchestration, webhook normalization, and provider switching
- `src/whatsapp.js`: provider-specific transport helpers for Meta Cloud API and AiSensy campaign sends
- `src/store.js`: bot conversations, reminders, dedupe, contact state

## Product modules

- Multi-tenant institute workspaces
- WhatsApp inbound and outbound automation
- Admissions-focused AI responses
- Lead capture and qualification
- Demo booking workflow
- Dashboard analytics and chat review
- Billing and plan management readiness

## Setup

1. Copy `.env.example` to `.env`
2. Configure the environment values you need
3. Start the server:

```bash
npm start
```

4. Open:

```text
http://localhost:3000/
```

5. Use `/app` for the SaaS dashboard

## Core environment variables

### Required for the bot core

- `NVIDIA_API_KEY`
- `MESSAGING_PROVIDER`

### Required when `MESSAGING_PROVIDER=aisensy`

- `AISENSY_API_KEY`
- `AISENSY_CAMPAIGN_NAME`
- `AISENSY_FLOW_TOKEN`

### Required when `MESSAGING_PROVIDER=meta`

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`

### Recommended for production

- `DATABASE_URL`
- `DATABASE_SSL=auto`
- `APP_BASE_URL`
- `WHATSAPP_APP_SECRET`
- `APP_COOKIE_SECURE=auto`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `WRITE_RATE_LIMIT_WINDOW_MS`
- `WRITE_RATE_LIMIT_MAX`

### Optional live-answer providers and integrations

- `GEMINI_API_KEY`
- `GEMINI_MEDIA_TIMEOUT_MS`
- `MEDIA_MAX_BYTES`
- `MEDIA_TEXT_MAX_CHARS`
- `ADMIN_API_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `WHATSAPP_PROVIDER` (backward-compatible alias for `MESSAGING_PROVIDER`)

### Optional Stripe billing

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BASIC`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_PREMIUM`

If the Stripe values are not set, the dashboard still works and the billing tab stays in manual-disabled mode.

## SaaS flow

1. Business owner signs up in `/app`
2. A business workspace is created automatically
3. Owner adds institute data, prompt, FAQs, courses, and WhatsApp credentials
4. Student messages the mapped WhatsApp number
5. Webhook resolves the correct institute
6. AI responds using only that institute context
7. Lead and booking signals are stored in the SaaS data layer
8. Owner reviews leads, chats, readiness, and billing from the dashboard

## Main routes

### Public and operator routes

- `GET /`
- `GET /app`
- `GET /app.js`
- `GET /app.css`
- `GET /health`
- `GET /ready`

### WhatsApp and billing webhooks

- `GET /webhooks/messaging`
- `POST /webhooks/messaging`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`
- `POST /webhooks/aisensy`
- `POST /integrations/aisensy/answer`
- `POST /webhooks/stripe`

### SaaS API

- `GET /api/plans`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/app/bootstrap`
- `GET /api/businesses`
- `POST /api/businesses`
- `GET /api/businesses/:id`
- `PATCH /api/businesses/:id`
- `GET /api/businesses/:id/dashboard`
- `GET /api/businesses/:id/leads`
- `PATCH /api/businesses/:id/leads/:leadId`
- `GET /api/businesses/:id/bookings`
- `POST /api/businesses/:id/bookings`
- `GET /api/businesses/:id/chats`
- `GET /api/businesses/:id/chats/:chatId`
- `GET /api/businesses/:id/billing`
- `POST /api/businesses/:id/billing/checkout`
- `POST /api/businesses/:id/billing/portal`

## Billing notes

- Stripe checkout creates a subscription session for the chosen plan
- Stripe customer and subscription IDs are stored on the business record
- Stripe webhook updates subscription status, billing period dates, and cancel-at-period-end state
- Success and cancel redirects return the operator to the billing tab in `/app`

## Security notes

- SaaS routes return CSP and basic security headers
- Mutating SaaS requests are protected by origin checks
- Auth and write APIs are rate limited in memory
- Session cookies are `HttpOnly` and `SameSite=Lax`
- `Secure` is added automatically when the request is served over HTTPS unless overridden by `APP_COOKIE_SECURE`
- Stripe webhook signatures are verified when `STRIPE_WEBHOOK_SECRET` is configured

## Persistence

The app now supports shared PostgreSQL-backed persistence for both:

- `src/store.js` bot data such as contacts, conversations, reminders, dedupe, and integrations
- `src/saas-store.js` SaaS data such as users, businesses, sessions, leads, bookings, team, API keys, audit logs, and usage

### Recommended production setup

- Set `DATABASE_URL` to a managed PostgreSQL instance
- Leave `DATABASE_SSL=auto` unless your provider needs something specific
- Start the app normally with `npm start`

When `DATABASE_URL` is configured, the app stores the logical JSON datasets inside PostgreSQL with transaction-backed row locking, so multiple app instances can safely share one central data store.

### Migration from existing local JSON files

If you already have data in `data/`, run:

```bash
npm run db:import
```

On first database initialization, any missing database rows are automatically seeded from the existing local JSON files. Local JSON remains a fallback for development when `DATABASE_URL` is not set.

## Readiness and diagnostics

Run:

```bash
npm run doctor
```

Run:

```bash
npm run doctor:meta
```

Run:

```bash
npm run doctor:public
```

`GET /ready` returns:

- `200` when required bot settings are present
- `503` when the active provider or bot settings are still missing

The dashboard also shows an institute-level readiness score so operators can see whether WhatsApp, AI content, FAQs, courses, and billing are configured.

## Deployment

- Backend: Railway, Render, AWS, or any Node host
- Frontend: already served by the same Node app, or can be fronted by a reverse proxy
- Production database: PostgreSQL via `DATABASE_URL`
- Local development fallback: JSON files in `data/` when `DATABASE_URL` is not set

## Test and verify

```bash
npm test
```

Use the active provider credentials plus a real Stripe test/live project to validate:

- webhook delivery
- outbound replies
- institute routing by provider metadata or phone mapping
- Stripe checkout redirects
- Stripe webhook subscription updates

## Current MVP boundary

This build is intentionally business-focused. It is not an open-ended general chatbot. The assistant should stay centered on admissions, courses, timings, FAQs, follow-ups, and demo conversion for each institute.
