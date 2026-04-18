import http from "node:http";
import { config } from "./config.js";
import {
  beginInboundProcessing,
  completeInboundProcessing,
  getInboundProcessingResult,
  hasRecentOutboundDedup,
  initStore,
  rememberOutboundDedup
} from "./store.js";
import { handleIncomingText, handleIncomingMedia } from "./agent.js";
import {
  buildMessagingWebhookSuccessResponse,
  describeIgnoredInbound,
  detectMessagingProvider,
  extractInboundMessages,
  outboundDedupKey,
  sendTextMessageChunked,
  sendTypingPresence,
  usesInlineReply,
  verifyMessagingWebhookGet,
  verifyMessagingWebhookPost
} from "./messaging.js";
import { startReminderLoop } from "./reminders.js";
import { getReadinessReport } from "./diagnostics.js";
import { extractTelegramInbound, sendTelegramMessage, setTelegramWebhook, getTelegramBotInfo } from "./telegram.js";
import { getBusinessByTelegramToken, updateBusinessTelegram } from "./saas-store.js";
import {
  getDataDeletionHtml,
  getPrivacyPolicyHtml,
  getTermsHtml
} from "./legal.js";
import {
  beginGoogleContactsOAuth,
  completeGoogleContactsOAuth,
  getGoogleContactsStatus,
  syncGoogleContacts
} from "./google-contacts.js";
import { initSaasStore } from "./saas-store.js";
import { resolveBusinessContextForMessage } from "./saas.js";
import { handleSaasRoute } from "./saas-routes.js";
import { handleStripeWebhookEvent } from "./billing.js";
import { handleRazorpayWebhookEvent, verifyRazorpayWebhookSignature } from "./razorpay-billing.js";
import { verifyStripeSignature } from "./security.js";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(payload);
}

function sendFormatted(response, result) {
  if (!result) {
    return;
  }

  if (result.format === "json") {
    sendJson(response, result.statusCode, result.body);
    return;
  }

  sendText(response, result.statusCode, result.body || "");
}

function sendHtml(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(payload);
}

function sendRedirect(response, statusCode, location) {
  response.writeHead(statusCode, {
    Location: location
  });
  response.end();
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseUrl(request) {
  return new URL(request.url, `http://${request.headers.host || "localhost"}`);
}

function requestOrigin(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol =
    forwardedProto || (request.socket.encrypted ? "https" : "http");
  const host = forwardedHost || request.headers.host || "localhost";
  return `${protocol}://${host}`;
}

function getAdminToken(request, url) {
  const authorization = String(request.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return (
    String(request.headers["x-admin-token"] || "").trim() ||
    String(url.searchParams.get("token") || "").trim()
  );
}

function requireAdminAccess(request, response, url) {
  if (!config.adminApiToken) {
    sendJson(response, 503, {
      error:
        "Google Contacts admin routes are disabled. Set ADMIN_API_TOKEN first."
    });
    return false;
  }

  if (getAdminToken(request, url) !== config.adminApiToken) {
    sendText(response, 403, "Forbidden");
    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function googleContactsDashboardHtml(status, adminToken = "") {
  const tokenQuery = adminToken ? `?token=${encodeURIComponent(adminToken)}` : "";
  const summaryJson = status.lastSyncSummary
    ? JSON.stringify(status.lastSyncSummary, null, 2)
    : "No sync has run yet.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Claw Cloud Google Contacts</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; background: #f4f7fb; color: #132238; }
      main { max-width: 860px; margin: 40px auto; padding: 0 20px; }
      .card { background: #fff; border: 1px solid #dbe5f0; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(19,34,56,.06); }
      h1 { margin: 0 0 12px; font-size: 30px; }
      h2 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.6; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
      .button { display: inline-block; padding: 12px 16px; border-radius: 10px; text-decoration: none; font-weight: 600; }
      .primary { background: #0b6bcb; color: #fff; }
      .secondary { background: #eaf2fb; color: #0b6bcb; }
      .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; }
      .ok { background: #e9f8ef; color: #0d7a34; }
      .warn { background: #fff2df; color: #a55a00; }
      pre { background: #0f1720; color: #eff6ff; padding: 16px; border-radius: 12px; overflow: auto; font-size: 13px; }
      ul { margin: 10px 0 0 18px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Google Contacts Integration</h1>
        <p>
          Status:
          <span class="badge ${status.connected ? "ok" : "warn"}">
            ${status.connected ? "Connected" : "Not connected"}
          </span>
        </p>
        <p>Redirect URI: <code>${escapeHtml(status.redirectUri || "Not configured")}</code></p>
        <p>Scope: <code>${escapeHtml(status.scope || "Not configured")}</code></p>
        <div class="row">
          <a class="button primary" href="/integrations/google/connect${tokenQuery}">Connect Google Contacts</a>
          <a class="button secondary" href="/integrations/google/sync${tokenQuery}">Run Contact Sync</a>
          <a class="button secondary" href="/integrations/google/status${tokenQuery}">View JSON Status</a>
        </div>
      </section>

      <section class="card">
        <h2>Configuration Checks</h2>
        <ul>
          ${Object.entries(status.checks)
            .map(
              ([key, value]) =>
                `<li><strong>${escapeHtml(key)}</strong>: ${value ? "configured" : "missing"}</li>`
            )
            .join("")}
        </ul>
        ${
          status.missing.length
            ? `<p><strong>Missing:</strong> ${escapeHtml(status.missing.join(", "))}</p>`
            : `<p>Everything required for Google Contacts sync is configured.</p>`
        }
      </section>

      <section class="card">
        <h2>Last Sync</h2>
        <p>Last sync time: ${escapeHtml(status.lastSyncAt || "Never")}</p>
        <pre>${escapeHtml(summaryJson)}</pre>
      </section>
    </main>
  </body>
</html>`;
}

function integrationResultHtml({ title, message, detail = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; background: #f4f7fb; color: #132238; margin: 0; }
      main { max-width: 720px; margin: 56px auto; padding: 0 20px; }
      .card { background: white; border: 1px solid #dbe5f0; border-radius: 16px; padding: 28px; box-shadow: 0 8px 24px rgba(19,34,56,.06); }
      h1 { margin-top: 0; }
      pre { background: #0f1720; color: #eff6ff; padding: 16px; border-radius: 12px; overflow: auto; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
      </section>
    </main>
  </body>
</html>`;
}

async function processInboundMessage(message, options = {}) {
  const replyMode = options.replyMode || "provider-send";
  const businessContext = await resolveBusinessContextForMessage(message);
  const replyIntegration =
    replyMode === "provider-send"
      ? {
          ...(businessContext?.messagingConfig ||
            businessContext?.whatsappConfig ||
            {}),
          provider: message.provider || config.messagingProvider
        }
      : businessContext?.messagingConfig || businessContext?.whatsappConfig || {};
  const autoReplyEnabled = businessContext
    ? businessContext.settings?.autoReplyEnabled !== false
    : config.whatsappAutoReply;

  if (!autoReplyEnabled) {
    console.log(
      `Skipping webhook auto-reply for ${message.messageId} from ${message.from}`
    );
    return;
  }

  const gate = await beginInboundProcessing(message.messageId);
  if (gate.status !== "accepted") {
    console.log(
      `Skipping duplicate inbound message ${message.messageId} from ${message.from}`
    );

    if (replyMode === "inline-reply") {
      const previous = await getInboundProcessingResult(message.messageId);
      return String(previous?.reply || "");
    }

    return;
  }

  let assistantReply = "";
  try {
    if (message.mediaId) {
      assistantReply = await handleIncomingMedia({
        ...message,
        businessContext
      });
    } else {
      assistantReply = await handleIncomingText({
        ...message,
        businessContext
      });
    }

    const dedupeKey = outboundDedupKey(
      `assistant-reply:${businessContext?.id || "default"}`,
      message.from,
      assistantReply,
      message.messageId
    );

    if (
      assistantReply &&
      replyMode === "provider-send" &&
      !(await hasRecentOutboundDedup(dedupeKey, 24 * 60 * 60 * 1000))
    ) {
      const delivery = await sendTextMessageChunked({
        to: message.from,
        body: assistantReply,
        // Plain outbound messages are more reliable than reply-context sends for
        // the user's live Meta number, and they avoid template-like rendering.
        replyToMessageId: "",
        integration: replyIntegration
      });

      await rememberOutboundDedup(dedupeKey, {
        delivery,
        inboundMessageId: message.messageId
      });

      console.log(
        `Answered inbound message ${message.messageId} for ${message.from} via ${
          replyIntegration.provider || "unknown"
        } with ${Array.isArray(delivery) ? delivery.length : 0} message(s)`
      );
    }

    await completeInboundProcessing(message.messageId, {
      reply: assistantReply,
      outcome: assistantReply ? "answered" : "empty_reply",
      businessId: businessContext?.id || ""
    });
  } catch (error) {
    console.error(
      `Failed to process inbound message ${message.messageId} from ${message.from}: ${error.message}`
    );

    await completeInboundProcessing(message.messageId, {
      error: error.message,
      outcome: "model_error_no_reply",
      businessId: businessContext?.id || ""
    });
  }

  return assistantReply;
}

function routeProviderHint(url) {
  if (url.pathname === "/webhooks/whatsapp") {
    return "meta";
  }

  if (
    url.pathname === "/webhooks/aisensy" ||
    url.pathname === "/integrations/aisensy/answer"
  ) {
    return "aisensy";
  }

  return "";
}

async function handleMessagingWebhookGet(request, response, providerHint = "") {
  const url = parseUrl(request);
  const provider = detectMessagingProvider({ url, providerHint });
  const verification = verifyMessagingWebhookGet({
    provider,
    headers: request.headers,
    url
  });

  if (!verification.ok) {
    sendFormatted(response, verification);
    return;
  }

  if (usesInlineReply(provider)) {
    const rawBody = await readRawBody(request);
    let payload = {};
    if (rawBody.length) {
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        sendText(response, 400, "Invalid JSON");
        return;
      }
    }

    const extracted = extractInboundMessages({ provider, payload, url });
    const incoming = extracted.filter((message) => message.text || message.mediaId);

    if (!incoming.length) {
      sendJson(response, 400, { error: "Missing required field: text" });
      return;
    }

    console.log(
      `AiSensy inbound GET request from ${incoming[0].from || "missing-from"} with text: ${String(
        incoming[0].text || ""
      ).slice(0, 80)}`
    );

    const answer = await processInboundMessage(incoming[0], {
      replyMode: "inline-reply"
    });
    console.log(
      `AiSensy inline GET reply length for ${incoming[0].from || "missing-from"}: ${
        String(answer || "").length
      }`
    );

    sendFormatted(
      response,
      buildMessagingWebhookSuccessResponse({
        provider,
        reply: answer,
        messageCount: incoming.length
      })
    );
    return;
  }

  sendFormatted(
    response,
    verification
  );
}

async function handleMessagingWebhookPost(request, response, providerHint = "", opts = {}) {
  const url = parseUrl(request);
  const rawBody = await readRawBody(request);
  let payload = {};
  try {
    payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    sendText(response, 400, "Invalid JSON");
    return;
  }

  const provider = detectMessagingProvider({ url, payload, providerHint });
  const verification = verifyMessagingWebhookPost({
    provider,
    rawBody,
    headers: request.headers,
    url
  });
  if (!verification.ok) {
    sendFormatted(response, verification);
    return;
  }

  const extracted = extractInboundMessages({ provider, payload, url });
  const incoming = extracted.filter((message) => message.text || message.mediaId);
  const ignored = extracted.filter((message) => !message.text && !message.mediaId);

  if (usesInlineReply(provider) && !opts.useProviderSend) {
    if (!incoming.length) {
      sendJson(response, 400, { error: "Missing required field: text" });
      return;
    }

    console.log(
      `AiSensy inbound request from ${incoming[0].from || "missing-from"} with text: ${String(
        incoming[0].text || ""
      ).slice(0, 80)}`
    );

    const answer = await processInboundMessage(incoming[0], {
      replyMode: "inline-reply"
    });
    console.log(
      `AiSensy inline reply length for ${incoming[0].from || "missing-from"}: ${
        String(answer || "").length
      }`
    );

    sendFormatted(
      response,
      buildMessagingWebhookSuccessResponse({
        provider,
        reply: answer,
        messageCount: incoming.length
      })
    );
    return;
  }

  sendFormatted(
    response,
    buildMessagingWebhookSuccessResponse({
      provider,
      messageCount: incoming.length
    })
  );

  if (ignored.length) {
    console.log(
      `Ignored ${ignored.length} inbound messages without readable text for ${provider}: ${describeIgnoredInbound(
        ignored
      )}`
    );
  }

  for (const message of incoming) {
    await processInboundMessage(message, {
      replyMode: "provider-send"
    });
  }
}

async function handleTelegramWebhook(request, response, url) {
  const businessId = url.pathname.replace("/webhooks/telegram/", "").split("/")[0];
  if (!businessId) {
    sendJson(response, 400, { error: "Missing business id" });
    return;
  }

  const rawBody = await readRawBody(request);
  let payload = {};
  try {
    payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    sendJson(response, 400, { error: "Invalid JSON" });
    return;
  }

  sendJson(response, 200, { ok: true });

  const inbound = extractTelegramInbound(payload);
  if (!inbound || !inbound.text) return;

  const business = await getBusinessByTelegramToken(businessId);
  if (!business?.telegram?.token) return;

  const token = business.telegram.token;

  try {
    const message = {
      ...inbound,
      businessId: business.id,
      provider: "telegram",
      phoneNumberId: "",
      displayPhoneNumber: ""
    };

    const { handleIncomingText } = await import("./agent.js");
    const reply = await handleIncomingText({
      business,
      message,
      replyMode: "return"
    });

    if (reply) {
      await sendTelegramMessage(token, inbound.chatId, reply);
    }
  } catch (err) {
    console.error("Telegram webhook error:", err);
  }
}

async function handleStripeWebhook(request, response) {
  if (!config.stripeWebhookSecret) {
    sendJson(response, 503, {
      error: "Stripe webhook is disabled. Set STRIPE_WEBHOOK_SECRET first."
    });
    return;
  }

  const rawBody = await readRawBody(request);
  const signatureHeader = request.headers["stripe-signature"];
  if (!verifyStripeSignature(rawBody, signatureHeader, config.stripeWebhookSecret)) {
    sendText(response, 400, "Invalid Stripe signature");
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendText(response, 400, "Invalid JSON");
    return;
  }

  await handleStripeWebhookEvent(event);
  sendJson(response, 200, { received: true });
}

async function handleRazorpayWebhook(request, response) {
  const rawBody = await readRawBody(request);
  const signatureHeader = request.headers["x-razorpay-signature"] || "";
  if (config.razorpayWebhookSecret && !verifyRazorpayWebhookSignature(rawBody, signatureHeader)) {
    sendText(response, 400, "Invalid Razorpay signature");
    return;
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendText(response, 400, "Invalid JSON");
    return;
  }
  await handleRazorpayWebhookEvent(event);
  sendJson(response, 200, { received: true });
}

async function requestListener(request, response) {
  const url = parseUrl(request);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: config.botName,
      model: config.nvidiaModel,
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/ready") {
    const report = getReadinessReport();
    sendJson(response, report.ready ? 200 : 503, report);
    return;
  }

  if (request.method === "GET" && url.pathname === "/privacy") {
    sendHtml(response, 200, getPrivacyPolicyHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/terms") {
    sendHtml(response, 200, getTermsHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/data-deletion") {
    sendHtml(response, 200, getDataDeletionHtml());
    return;
  }

  if (request.method === "GET" && url.pathname === "/integrations/google") {
    if (!requireAdminAccess(request, response, url)) {
      return;
    }

    const status = await getGoogleContactsStatus(requestOrigin(request));
    sendHtml(
      response,
      200,
      googleContactsDashboardHtml(status, getAdminToken(request, url))
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/integrations/google/status") {
    if (!requireAdminAccess(request, response, url)) {
      return;
    }

    const status = await getGoogleContactsStatus(requestOrigin(request));
    sendJson(response, 200, status);
    return;
  }

  if (request.method === "GET" && url.pathname === "/integrations/google/connect") {
    if (!requireAdminAccess(request, response, url)) {
      return;
    }

    const authUrl = await beginGoogleContactsOAuth(requestOrigin(request));
    sendRedirect(response, 302, authUrl);
    return;
  }

  if (request.method === "GET" && url.pathname === "/integrations/google/callback") {
    const error = url.searchParams.get("error");
    if (error) {
      sendHtml(
        response,
        400,
        integrationResultHtml({
          title: "Google connection failed",
          message: "Google returned an authorization error.",
          detail: error
        })
      );
      return;
    }

    try {
      const summary = await completeGoogleContactsOAuth({
        code: url.searchParams.get("code") || "",
        state: url.searchParams.get("state") || "",
        origin: requestOrigin(request)
      });

      sendHtml(
        response,
        200,
        integrationResultHtml({
          title: "Google Contacts connected",
          message:
            "Google Contacts has been connected successfully and the first sync has completed.",
          detail: JSON.stringify(summary, null, 2)
        })
      );
    } catch (callbackError) {
      sendHtml(
        response,
        400,
        integrationResultHtml({
          title: "Google callback failed",
          message:
            "The Google Contacts callback could not be completed. Please reconnect and try again.",
          detail: callbackError.message
        })
      );
    }
    return;
  }

  if (
    (request.method === "GET" || request.method === "POST") &&
    url.pathname === "/integrations/google/sync"
  ) {
    if (!requireAdminAccess(request, response, url)) {
      return;
    }

    const summary = await syncGoogleContacts(requestOrigin(request));

    if (request.method === "GET") {
      sendHtml(
        response,
        200,
        integrationResultHtml({
          title: "Google Contacts sync complete",
          message: "The latest Google Contacts import completed successfully.",
          detail: JSON.stringify(summary, null, 2)
        })
      );
      return;
    }

    sendJson(response, 200, {
      ok: true,
      summary
    });
    return;
  }

  if (url.pathname === "/webhooks/messaging" && request.method === "GET") {
    await handleMessagingWebhookGet(request, response, routeProviderHint(url));
    return;
  }

  if (url.pathname === "/webhooks/messaging" && request.method === "POST") {
    await handleMessagingWebhookPost(request, response, routeProviderHint(url));
    return;
  }

  if (url.pathname === "/webhooks/whatsapp" && request.method === "GET") {
    await handleMessagingWebhookGet(request, response, "meta");
    return;
  }

  if (url.pathname === "/webhooks/whatsapp" && request.method === "POST") {
    await handleMessagingWebhookPost(request, response, "meta");
    return;
  }

  if (url.pathname === "/webhooks/aisensy" && request.method === "POST") {
    await handleMessagingWebhookPost(request, response, "aisensy", { useProviderSend: true });
    return;
  }

  if (url.pathname === "/integrations/aisensy/answer" && request.method === "GET") {
    await handleMessagingWebhookGet(request, response, "aisensy");
    return;
  }

  if (url.pathname === "/integrations/aisensy/answer" && request.method === "POST") {
    await handleMessagingWebhookPost(request, response, "aisensy");
    return;
  }

  if (url.pathname.startsWith("/webhooks/telegram/") && request.method === "POST") {
    await handleTelegramWebhook(request, response, url);
    return;
  }

  if (url.pathname === "/webhooks/stripe" && request.method === "POST") {
    await handleStripeWebhook(request, response);
    return;
  }

  if (url.pathname === "/webhooks/razorpay" && request.method === "POST") {
    await handleRazorpayWebhook(request, response);
    return;
  }

  if (await handleSaasRoute({ request, response, url, readRawBody })) {
    return;
  }

  sendText(response, 404, "Not found");
}

// Prevent unhandled promise rejections from crashing the container
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (kept alive):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (kept alive):", error);
});

await initStore();
await initSaasStore();
const stopReminderLoop = startReminderLoop();

const server = http.createServer((request, response) => {
  requestListener(request, response).catch((error) => {
    console.error("Request error:", error.message);
    try {
      sendJson(response, 500, { error: error.message });
    } catch {
      // response already sent — ignore
    }
  });
});

server.listen(config.port, () => {
  console.log(
    `${config.botName} listening on http://localhost:${config.port} with model ${config.nvidiaModel}`
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopReminderLoop();
    server.close(() => process.exit(0));
  });
}
