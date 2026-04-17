import { config } from "./config.js";
import { extractAiSensyFlowInput } from "./aisensy-flow.js";
import { hashText } from "./lib/text.js";
import {
  downloadWhatsAppMedia,
  extractIncomingMessages as extractMetaIncomingMessages,
  outboundDedupKey,
  sendTypingIndicator as sendProviderTypingIndicator,
  sendWhatsAppText,
  sendWhatsAppTextChunked,
  verifyWhatsAppSignature
} from "./whatsapp.js";

const SUPPORTED_PROVIDERS = new Set(["aisensy", "meta"]);

function cleanText(value) {
  return String(value || "").trim();
}

function buildDerivedMessageId(parts = []) {
  const source = parts.map((part) => cleanText(part)).filter(Boolean).join("|");
  return `derived:${hashText(source || Date.now())}`;
}

function explicitProvider(value) {
  const normalized = cleanText(value).toLowerCase();
  return SUPPORTED_PROVIDERS.has(normalized) ? normalized : "";
}

function requestToken(headers = {}, url) {
  const authorization = cleanText(headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return (
    cleanText(headers["x-admin-token"] || "") ||
    cleanText(url?.searchParams?.get("token") || "")
  );
}

function inferProviderFromPath(pathname = "") {
  const source = cleanText(pathname).toLowerCase();
  if (
    source.endsWith("/whatsapp") ||
    source.endsWith("/meta") ||
    source.includes("/webhooks/whatsapp")
  ) {
    return "meta";
  }

  if (
    source.endsWith("/aisensy") ||
    source.includes("/integrations/aisensy/answer")
  ) {
    return "aisensy";
  }

  return "";
}

function normalizeInboundMessage(fields = {}) {
  const provider = normalizeMessagingProvider(fields.provider);
  const providerMessageId = cleanText(fields.providerMessageId || fields.messageId);
  return {
    provider,
    messageId:
      cleanText(fields.messageId) || `${provider}:${providerMessageId || buildDerivedMessageId([
        provider,
        fields.from,
        fields.text,
        fields.timestamp,
        fields.phoneNumberId,
        fields.displayPhoneNumber
      ])}`,
    providerMessageId:
      providerMessageId || buildDerivedMessageId([provider, fields.from, fields.text, fields.timestamp]),
    businessId: cleanText(fields.businessId),
    from: cleanText(fields.from),
    profileName: cleanText(fields.profileName),
    timestamp: cleanText(fields.timestamp),
    text: cleanText(fields.text),
    type: cleanText(fields.type || (fields.mediaId ? fields.mediaType || "media" : "text")),
    mediaId: cleanText(fields.mediaId),
    mediaType: cleanText(fields.mediaType),
    mimeType: cleanText(fields.mimeType),
    caption: cleanText(fields.caption),
    filename: cleanText(fields.filename),
    phoneNumberId: cleanText(fields.phoneNumberId),
    displayPhoneNumber: cleanText(fields.displayPhoneNumber)
  };
}

export function normalizeMessagingProvider(
  value,
  fallback = config.messagingProvider || config.whatsappProvider || "aisensy"
) {
  return explicitProvider(value) || explicitProvider(fallback) || "aisensy";
}

export function resolveMessagingIntegration(overrides = {}) {
  return {
    provider: normalizeMessagingProvider(
      overrides.provider || overrides.messagingProvider
    ),
    accessToken: cleanText(overrides.accessToken || config.whatsappAccessToken),
    phoneNumberId: cleanText(overrides.phoneNumberId || config.whatsappPhoneNumberId),
    businessAccountId: cleanText(
      overrides.businessAccountId || config.whatsappBusinessAccountId
    ),
    displayPhoneNumber: cleanText(overrides.displayPhoneNumber),
    graphVersion: cleanText(overrides.graphVersion || config.whatsappGraphVersion),
    whatsappAppSecret: cleanText(overrides.whatsappAppSecret || config.whatsappAppSecret),
    aisensyApiKey: cleanText(overrides.aisensyApiKey || config.aisensyApiKey),
    aisensyCampaignName: cleanText(
      overrides.aisensyCampaignName || config.aisensyCampaignName
    ),
    aisensyApiUrl: cleanText(overrides.aisensyApiUrl || config.aisensyApiUrl),
    aisensySource: cleanText(overrides.aisensySource || config.aisensySource),
    aisensyDefaultUserName: cleanText(
      overrides.aisensyDefaultUserName || config.aisensyDefaultUserName
    ),
    aisensyFlowToken: cleanText(overrides.aisensyFlowToken || config.aisensyFlowToken)
  };
}

export function detectMessagingProvider({
  url = null,
  payload = null,
  providerHint = ""
} = {}) {
  const hinted = explicitProvider(providerHint);
  if (hinted) {
    return hinted;
  }

  const pathnameProvider = inferProviderFromPath(url?.pathname || "");
  if (pathnameProvider) {
    return pathnameProvider;
  }

  const queryProvider = explicitProvider(url?.searchParams?.get("provider"));
  if (queryProvider) {
    return queryProvider;
  }

  const payloadProvider =
    explicitProvider(payload?.provider) ||
    explicitProvider(payload?.messagingProvider) ||
    explicitProvider(payload?.sourceProvider);
  if (payloadProvider) {
    return payloadProvider;
  }

  if (Array.isArray(payload?.entry)) {
    return "meta";
  }

  if (
    payload &&
    typeof payload === "object" &&
    (
      cleanText(payload.message) ||
      cleanText(payload.text) ||
      payload.contact ||
      payload.attributes ||
      payload.customer
    )
  ) {
    return "aisensy";
  }

  return normalizeMessagingProvider("");
}

export function usesInlineReply(provider) {
  return normalizeMessagingProvider(provider) === "aisensy";
}

export function verifyMessagingWebhookGet({ provider, headers = {}, url }) {
  const normalizedProvider = normalizeMessagingProvider(provider);

  if (normalizedProvider === "aisensy") {
    if (!config.aisensyFlowToken) {
      return {
        ok: false,
        statusCode: 503,
        format: "json",
        body: {
          error:
            "AiSensy webhook is disabled. Set AISENSY_FLOW_TOKEN first."
        }
      };
    }

    if (requestToken(headers, url) !== config.aisensyFlowToken) {
      return {
        ok: false,
        statusCode: 403,
        format: "text",
        body: "Forbidden"
      };
    }

    return { ok: true };
  }

  if (normalizedProvider !== "meta") {
    return {
      ok: false,
      statusCode: 405,
      format: "text",
      body: "Method not allowed"
    };
  }

  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
    return {
      ok: true,
      statusCode: 200,
      format: "text",
      body: challenge || ""
    };
  }

  return {
    ok: false,
    statusCode: 403,
    format: "text",
    body: "Forbidden"
  };
}

export function verifyMessagingWebhookPost({ provider, rawBody, headers = {}, url }) {
  const normalizedProvider = normalizeMessagingProvider(provider);

  if (normalizedProvider === "aisensy") {
    if (!config.aisensyFlowToken) {
      return {
        ok: false,
        statusCode: 503,
        format: "json",
        body: {
          error:
            "AiSensy webhook is disabled. Set AISENSY_FLOW_TOKEN first."
        }
      };
    }

    if (requestToken(headers, url) !== config.aisensyFlowToken) {
      return {
        ok: false,
        statusCode: 403,
        format: "text",
        body: "Forbidden"
      };
    }

    return { ok: true };
  }

  if (!verifyWhatsAppSignature(rawBody, headers["x-hub-signature-256"])) {
    return {
      ok: false,
      statusCode: 401,
      format: "text",
      body: "Invalid signature"
    };
  }

  return { ok: true };
}

export function extractInboundMessages({ provider, payload = {}, url }) {
  const normalizedProvider = normalizeMessagingProvider(provider);

  if (normalizedProvider === "aisensy") {
    const input = extractAiSensyFlowInput(payload, url?.searchParams || new URLSearchParams());
    if (!input.text && !input.mediaId) {
      return [];
    }

    // AiSensy Flow Builder API requests often do not send a stable message id or
    // timestamp, and when they do send ids they can still be reused across the
    // same live-chat thread. We therefore always derive our own internal message
    // id for dedupe from the actual inbound content plus a best-effort event
    // stamp so repeated prompts do not get stuck reusing an old empty reply.
    const fallbackFlowStamp = input.timestamp || `flow:${Date.now()}`;
    const derivedProviderMessageId = buildDerivedMessageId([
      input.from,
      input.text,
      fallbackFlowStamp,
      input.businessId,
      input.phoneNumberId,
      input.displayPhoneNumber
    ]);
    const providerMessageId = input.messageId || derivedProviderMessageId;

    return [
      normalizeInboundMessage({
        provider: "aisensy",
        messageId: `aisensy:${derivedProviderMessageId}`,
        providerMessageId,
        businessId: input.businessId,
        from: input.from || "0000000000",
        profileName: input.profileName,
        timestamp: input.timestamp,
        text: input.text,
        type: input.mediaId ? input.mediaType || "media" : "text",
        mediaId: input.mediaId,
        mediaType: input.mediaType,
        mimeType: input.mimeType,
        caption: input.caption,
        filename: input.filename,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber
      })
    ];
  }

  return extractMetaIncomingMessages(payload).map((message) =>
    normalizeInboundMessage({
      ...message,
      provider: "meta",
      messageId: `meta:${message.messageId}`,
      providerMessageId: message.messageId
    })
  );
}

export function buildMessagingWebhookSuccessResponse({
  provider,
  reply = "",
  messageCount = 0
} = {}) {
  const normalizedProvider = normalizeMessagingProvider(provider);
  if (usesInlineReply(normalizedProvider)) {
    const inlineReply = String(reply || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const safeReply =
      inlineReply.length <= 4000
        ? inlineReply
        : `${inlineReply.slice(0, 3997).trimEnd()}...`;
    const compactReply = safeReply
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      statusCode: 200,
      format: "json",
      body: {
        data: {
          reply: safeReply,
          botreply: safeReply,
          text: safeReply,
          message: safeReply
        },
        botreply: safeReply,
        reply: safeReply,
        text: safeReply,
        message: safeReply,
        compactReply
      }
    };
  }

  return {
    statusCode: 200,
    format: "json",
    body: {
      provider: normalizedProvider,
      received: true,
      messages: messageCount
    }
  };
}

export function describeIgnoredInbound(messages = []) {
  return messages.map((message) => message.type || "unknown").join(", ");
}

export async function sendTextMessage(options = {}) {
  return sendWhatsAppText({
    ...options,
    integration: resolveMessagingIntegration(options.integration || {})
  });
}

export async function sendTextMessageChunked(options = {}) {
  return sendWhatsAppTextChunked({
    ...options,
    integration: resolveMessagingIntegration(options.integration || {})
  });
}

export async function sendTypingPresence(inboundMessageId, integration = {}) {
  return sendProviderTypingIndicator(
    inboundMessageId,
    resolveMessagingIntegration(integration)
  );
}

export async function downloadInboundMedia(mediaId, integration = {}) {
  return downloadWhatsAppMedia(
    mediaId,
    resolveMessagingIntegration(integration)
  );
}

export { outboundDedupKey };
