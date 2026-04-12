import http from "node:http";
import { config } from "./config.js";
import {
  beginInboundProcessing,
  completeInboundProcessing,
  hasRecentOutboundDedup,
  initStore,
  rememberOutboundDedup
} from "./store.js";
import { handleIncomingText } from "./agent.js";
import {
  extractIncomingMessages,
  outboundDedupKey,
  sendTypingIndicator,
  sendWhatsAppTextChunked,
  verifyWhatsAppSignature
} from "./whatsapp.js";
import { startReminderLoop } from "./reminders.js";
import { getReadinessReport } from "./diagnostics.js";
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(payload);
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

async function processInboundMessage(message) {
  const gate = await beginInboundProcessing(message.messageId);
  if (gate.status !== "accepted") {
    console.log(
      `Skipping duplicate inbound message ${message.messageId} from ${message.from}`
    );
    return;
  }

  sendTypingIndicator(message.messageId).catch(() => {});

  let assistantReply = "";
  try {
    assistantReply = await handleIncomingText(message);

    const dedupeKey = outboundDedupKey(
      "assistant-reply",
      message.from,
      assistantReply,
      message.messageId
    );

    if (
      assistantReply &&
      !(await hasRecentOutboundDedup(dedupeKey, 24 * 60 * 60 * 1000))
    ) {
      const delivery = await sendWhatsAppTextChunked({
        to: message.from,
        body: assistantReply,
        replyToMessageId: message.messageId
      });

      await rememberOutboundDedup(dedupeKey, {
        delivery,
        inboundMessageId: message.messageId
      });

      console.log(
        `Answered inbound message ${message.messageId} for ${message.from}`
      );
    }

    await completeInboundProcessing(message.messageId, {
      reply: assistantReply,
      outcome: assistantReply ? "answered" : "empty_reply"
    });
  } catch (error) {
    console.error(
      `Failed to process inbound message ${message.messageId} from ${message.from}: ${error.message}`
    );

    await completeInboundProcessing(message.messageId, {
      error: error.message,
      outcome: "model_error_no_reply"
    });
  }
}

async function handleWebhookGet(request, response) {
  const url = parseUrl(request);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
    sendText(response, 200, challenge || "");
    return;
  }

  sendText(response, 403, "Forbidden");
}

async function handleWebhookPost(request, response) {
  const rawBody = await readRawBody(request);
  const signatureHeader = request.headers["x-hub-signature-256"];

  if (!verifyWhatsAppSignature(rawBody, signatureHeader)) {
    sendText(response, 401, "Invalid signature");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendText(response, 400, "Invalid JSON");
    return;
  }

  const extracted = extractIncomingMessages(payload);
  const incoming = extracted.filter((message) => message.text);
  const ignored = extracted.filter((message) => !message.text);

  sendJson(response, 200, { received: true, messages: incoming.length });

  if (ignored.length) {
    console.log(
      `Ignored ${ignored.length} inbound WhatsApp messages without readable text: ${ignored
        .map((message) => message.type || "unknown")
        .join(", ")}`
    );
  }

  for (const message of incoming) {
    await processInboundMessage(message);
  }
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

  if (url.pathname === "/webhooks/whatsapp" && request.method === "GET") {
    await handleWebhookGet(request, response);
    return;
  }

  if (url.pathname === "/webhooks/whatsapp" && request.method === "POST") {
    await handleWebhookPost(request, response);
    return;
  }

  sendText(response, 404, "Not found");
}

await initStore();
const stopReminderLoop = startReminderLoop();

const server = http.createServer((request, response) => {
  requestListener(request, response).catch((error) => {
    sendJson(response, 500, {
      error: error.message
    });
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
