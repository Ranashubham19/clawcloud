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
  sendWhatsAppText,
  verifyWhatsAppSignature
} from "./whatsapp.js";
import { startReminderLoop } from "./reminders.js";
import { getReadinessReport } from "./diagnostics.js";

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

async function processInboundMessage(message) {
  const gate = await beginInboundProcessing(message.messageId);
  if (gate.status !== "accepted") {
    return;
  }

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
      const delivery = await sendWhatsAppText({
        to: message.from,
        body: assistantReply,
        replyToMessageId: message.messageId
      });

      await rememberOutboundDedup(dedupeKey, {
        delivery,
        inboundMessageId: message.messageId
      });
    }

    await completeInboundProcessing(message.messageId, {
      reply: assistantReply
    });
  } catch (error) {
    const fallback =
      "I hit a temporary issue while processing that. Please try again in a moment.";

    const dedupeKey = outboundDedupKey(
      "assistant-error",
      message.from,
      fallback,
      message.messageId
    );

    if (!(await hasRecentOutboundDedup(dedupeKey, 24 * 60 * 60 * 1000))) {
      try {
        const delivery = await sendWhatsAppText({
          to: message.from,
          body: fallback,
          replyToMessageId: message.messageId
        });
        await rememberOutboundDedup(dedupeKey, {
          delivery,
          inboundMessageId: message.messageId
        });
      } catch {
        // Ignore nested send failures.
      }
    }

    await completeInboundProcessing(message.messageId, {
      error: error.message
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

  const incoming = extractIncomingMessages(payload).filter(
    (message) => message.text && message.type === "text"
  );

  sendJson(response, 200, { received: true, messages: incoming.length });

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
