import crypto from "node:crypto";
import { config, requireConfig } from "./config.js";
import { hashText } from "./lib/text.js";

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker", "voice"];

function cleanText(value) {
  return String(value || "").trim();
}

function parseJsonBody(body) {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function parseMetaErrorNumber(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMetaApiErrorDetails(parsed = {}, rawBody = "") {
  const error = parsed?.error || {};
  return {
    message: cleanText(
      error.message ||
        error.error_user_msg ||
        parsed?.message ||
        rawBody ||
        "Unknown Meta API error"
    ),
    type: cleanText(error.type),
    code: parseMetaErrorNumber(error.code),
    subcode: parseMetaErrorNumber(error.error_subcode),
    fbtraceId: cleanText(error.fbtrace_id)
  };
}

export function classifyMetaApiError(status, parsed = {}, rawBody = "") {
  const details = getMetaApiErrorDetails(parsed, rawBody);
  const haystack = `${details.type} ${details.message} ${rawBody}`.toLowerCase();

  if (
    details.code === 190 ||
    haystack.includes("error validating access token") ||
    haystack.includes("session is invalid") ||
    haystack.includes("access token has expired") ||
    haystack.includes("invalid oauth access token")
  ) {
    return "META_AUTH_INVALID";
  }

  if (details.code === 131030 || haystack.includes("not in allowed list")) {
    return "RECIPIENT_NOT_ALLOWED";
  }

  if (
    haystack.includes("invalid_parameter") ||
    haystack.includes("invalid parameter")
  ) {
    return "INVALID_PHONE";
  }

  if (status === 429 || [4, 17, 32, 613].includes(details.code)) {
    return "RATE_LIMITED";
  }

  if ([10, 200, 201, 299].includes(details.code) || haystack.includes("permission")) {
    return "META_PERMISSION_DENIED";
  }

  return "META_API_ERROR";
}

export function formatMetaApiError(prefix, status, parsed = {}, rawBody = "") {
  const details = getMetaApiErrorDetails(parsed, rawBody);
  const classification = classifyMetaApiError(status, parsed, rawBody);
  const metaParts = [];
  if (details.code !== null) metaParts.push(`code ${details.code}`);
  if (details.subcode !== null) metaParts.push(`subcode ${details.subcode}`);
  if (details.type) metaParts.push(details.type);
  if (details.fbtraceId) metaParts.push(`fbtrace ${details.fbtraceId}`);
  const metaSuffix = metaParts.length ? ` (${metaParts.join(", ")})` : "";
  const statusText = status ? ` ${status}` : "";

  if (classification === "META_AUTH_INVALID") {
    return `${classification}: ${prefix}${statusText}${metaSuffix}: ${details.message}. Required: replace the Meta WhatsApp access token with a permanent System User token that has whatsapp_business_messaging and whatsapp_business_management permissions, then update WHATSAPP_ACCESS_TOKEN in Railway or reconnect the workspace WhatsApp token.`;
  }

  if (classification === "META_PERMISSION_DENIED") {
    return `${classification}: ${prefix}${statusText}${metaSuffix}: ${details.message}. Required: assign the WhatsApp Business Account and phone number asset to the token's System User and include whatsapp_business_messaging plus whatsapp_business_management permissions.`;
  }

  return `${prefix}${statusText}${metaSuffix}: ${details.message}`;
}

async function readMetaApiError(response, prefix) {
  const rawBody = await response.text();
  const parsed = parseJsonBody(rawBody);
  const classification = classifyMetaApiError(response.status, parsed, rawBody);
  return {
    rawBody,
    parsed,
    classification,
    message: formatMetaApiError(prefix, response.status, parsed, rawBody)
  };
}

function resolveIntegration(overrides = {}) {
  return {
    provider: cleanText(overrides.provider || config.whatsappProvider || "meta").toLowerCase(),
    accessToken: cleanText(overrides.accessToken || config.whatsappAccessToken),
    appSecret: cleanText(overrides.appSecret || overrides.whatsappAppSecret || config.whatsappAppSecret),
    phoneNumberId: cleanText(overrides.phoneNumberId || config.whatsappPhoneNumberId),
    businessAccountId: cleanText(
      overrides.businessAccountId || config.whatsappBusinessAccountId
    ),
    graphVersion: cleanText(overrides.graphVersion || config.whatsappGraphVersion),
    aisensyApiKey: cleanText(overrides.aisensyApiKey || config.aisensyApiKey),
    aisensyCampaignName: cleanText(
      overrides.aisensyCampaignName || config.aisensyCampaignName
    ),
    aisensyApiUrl: cleanText(overrides.aisensyApiUrl || config.aisensyApiUrl),
    aisensySource: cleanText(overrides.aisensySource || config.aisensySource),
    aisensyDefaultUserName: cleanText(
      overrides.aisensyDefaultUserName || config.aisensyDefaultUserName
    )
  };
}

export function verifyWhatsAppSignatureWithSecret(rawBody, signatureHeader, appSecret) {
  const secret = cleanText(appSecret);
  if (!secret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader.slice("sha256=".length)),
    Buffer.from(expected)
  );
}

export function verifyWhatsAppSignature(rawBody, signatureHeader) {
  return verifyWhatsAppSignatureWithSecret(rawBody, signatureHeader, config.whatsappAppSecret);
}

function extractMedia(message) {
  for (const kind of MEDIA_TYPES) {
    if (message.type === kind && message[kind]) {
      const media = message[kind];
      return {
        mediaId: media.id || "",
        mediaType: kind,
        mimeType: media.mime_type || "",
        caption: media.caption || "",
        filename: media.filename || ""
      };
    }
  }
  return null;
}

export function extractIncomingMessages(payload) {
  const found = [];
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const messages = value.messages || [];
      const metadata = value.metadata || {};

      for (const message of messages) {
        const profileName = contacts[0]?.profile?.name || "";
        const text =
          message?.text?.body ||
          message?.button?.text ||
          message?.interactive?.button_reply?.title ||
          message?.interactive?.list_reply?.title ||
          "";

        const media = extractMedia(message);

        found.push({
          messageId: message.id,
          from: message.from,
          profileName,
          timestamp: message.timestamp,
          text,
          type: message.type,
          mediaId: media?.mediaId || "",
          mediaType: media?.mediaType || "",
          mimeType: media?.mimeType || "",
          caption: media?.caption || "",
          filename: media?.filename || "",
          phoneNumberId: metadata.phone_number_id || "",
          displayPhoneNumber: metadata.display_phone_number || ""
        });
      }
    }
  }

  return found;
}

export function extractMessageStatuses(payload) {
  const found = [];
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const metadata = value.metadata || {};

      for (const status of value.statuses || []) {
        const errors = Array.isArray(status.errors)
          ? status.errors.map((error) => ({
              code: String(error?.code || ""),
              title: String(error?.title || ""),
              message: String(error?.message || ""),
              details: String(error?.error_data?.details || "")
            }))
          : [];

        found.push({
          id: String(status.id || ""),
          status: String(status.status || ""),
          timestamp: String(status.timestamp || ""),
          recipientId: String(status.recipient_id || ""),
          conversationId: String(status.conversation?.id || ""),
          pricingCategory: String(status.pricing?.category || ""),
          phoneNumberId: String(metadata.phone_number_id || ""),
          displayPhoneNumber: String(metadata.display_phone_number || ""),
          errors
        });
      }
    }
  }

  return found;
}

export async function downloadWhatsAppMedia(mediaId, integration = {}) {
  const runtime = resolveIntegration(integration);
  if (runtime.provider !== "meta") {
    throw new Error("MEDIA_DOWNLOAD_UNSUPPORTED");
  }
  requireConfig("WHATSAPP_ACCESS_TOKEN", runtime.accessToken);

  const infoRes = await fetch(
    `https://graph.facebook.com/${runtime.graphVersion}/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${runtime.accessToken}` }
    }
  );

  if (!infoRes.ok) {
    const apiError = await readMetaApiError(infoRes, "WhatsApp media info error");
    throw new Error(apiError.message);
  }

  const info = await infoRes.json();

  const dataRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${runtime.accessToken}` }
  });

  if (!dataRes.ok) {
    const apiError = await readMetaApiError(dataRes, "WhatsApp media download error");
    throw new Error(apiError.message);
  }

  const buffer = Buffer.from(await dataRes.arrayBuffer());
  return {
    data: buffer,
    mimeType: info.mime_type || "application/octet-stream"
  };
}

export async function getWhatsAppPhoneNumberInfo(phoneNumberId, integration = {}) {
  const runtime = resolveIntegration(integration);
  const targetPhoneNumberId = cleanText(phoneNumberId || runtime.phoneNumberId);
  requireConfig("WHATSAPP_ACCESS_TOKEN", runtime.accessToken);
  if (!targetPhoneNumberId) {
    throw new Error("WhatsApp Phone Number ID is required.");
  }

  const response = await fetch(
    `https://graph.facebook.com/${runtime.graphVersion}/${targetPhoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,name_status`,
    {
      headers: { Authorization: `Bearer ${runtime.accessToken}` }
    }
  );

  const details = await response.text();
  let parsed = {};
  try {
    parsed = details ? JSON.parse(details) : {};
  } catch {
    parsed = { raw: details };
  }

  if (!response.ok) {
    throw new Error(
      formatMetaApiError("WhatsApp connect failed", response.status, parsed, details)
    );
  }

  return parsed;
}

function asAiSensyDestination(to) {
  const value = cleanText(to);
  const digits = value.replace(/\D/g, "");
  return digits || value;
}

export function buildAiSensyCampaignPayload({ to, body, userName = "", integration = {} }) {
  const runtime = resolveIntegration(integration);
  return {
    apiKey: runtime.aisensyApiKey,
    campaignName: runtime.aisensyCampaignName,
    destination: asAiSensyDestination(to),
    userName: userName || runtime.aisensyDefaultUserName,
    source: runtime.aisensySource,
    templateParams: [String(body || "")],
    tags: ["claw-cloud-ai"],
    attributes: {
      claw_cloud_provider: "aisensy",
      claw_cloud_last_reply: String(body || "").slice(0, 512)
    }
  };
}

async function sendAiSensyText({ to, body, integration = {} }) {
  const runtime = resolveIntegration(integration);
  requireConfig("AISENSY_API_KEY", runtime.aisensyApiKey);
  requireConfig("AISENSY_CAMPAIGN_NAME", runtime.aisensyCampaignName);

  const response = await fetch(runtime.aisensyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildAiSensyCampaignPayload({ to, body, integration: runtime }))
  });

  const details = await response.text();
  let parsed = {};
  try {
    parsed = details ? JSON.parse(details) : {};
  } catch {
    parsed = { raw: details };
  }

  if (!response.ok) {
    throw new Error(
      `AiSensy API error ${response.status}: ${details.slice(0, 400)}`
    );
  }

  return {
    provider: "aisensy",
    destination: asAiSensyDestination(to),
    response: parsed
  };
}

export async function sendWhatsAppText({
  to,
  body,
  replyToMessageId = "",
  previewUrl = false,
  integration = {}
}) {
  const runtime = resolveIntegration(integration);

  if (runtime.provider === "aisensy") {
    return sendAiSensyText({ to, body, integration: runtime });
  }

  requireConfig("WHATSAPP_ACCESS_TOKEN", runtime.accessToken);
  requireConfig("WHATSAPP_PHONE_NUMBER_ID", runtime.phoneNumberId);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: previewUrl,
      body
    }
  };

  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  const response = await fetch(
    `https://graph.facebook.com/${runtime.graphVersion}/${runtime.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const apiError = await readMetaApiError(response, "WhatsApp API error");
    let reason = apiError.message;

    if (apiError.classification === "RECIPIENT_NOT_ALLOWED") {
      reason = "RECIPIENT_NOT_ALLOWED";
    } else if (apiError.classification === "INVALID_PHONE") {
      reason = "INVALID_PHONE";
    } else if (apiError.classification === "RATE_LIMITED") {
      reason = "RATE_LIMITED";
    }

    throw new Error(reason);
  }

  return response.json();
}

function splitByLength(text, maxLen) {
  if (text.length <= maxLen) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLen) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }

    if (paragraph.length <= maxLen) {
      buffer = paragraph;
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let sentenceBuffer = "";

    for (const sentence of sentences) {
      const sentenceCandidate = sentenceBuffer
        ? `${sentenceBuffer} ${sentence}`
        : sentence;
      if (sentenceCandidate.length <= maxLen) {
        sentenceBuffer = sentenceCandidate;
        continue;
      }

      if (sentenceBuffer) {
        chunks.push(sentenceBuffer);
        sentenceBuffer = "";
      }

      if (sentence.length <= maxLen) {
        sentenceBuffer = sentence;
        continue;
      }

      const words = sentence.split(/\s+/);
      let wordBuffer = "";

      for (const word of words) {
        if (word.length > maxLen) {
          if (wordBuffer) {
            chunks.push(wordBuffer);
            wordBuffer = "";
          }

          for (let index = 0; index < word.length; index += maxLen) {
            chunks.push(word.slice(index, index + maxLen));
          }
          continue;
        }

        const wordCandidate = wordBuffer ? `${wordBuffer} ${word}` : word;
        if (wordCandidate.length <= maxLen) {
          wordBuffer = wordCandidate;
          continue;
        }

        if (wordBuffer) {
          chunks.push(wordBuffer);
        }
        wordBuffer = word;
      }

      if (wordBuffer) {
        chunks.push(wordBuffer);
      }
    }

    if (sentenceBuffer) {
      chunks.push(sentenceBuffer);
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.filter((chunk) => chunk.trim().length);
}

export function splitWhatsAppMessage(body, maxLen = 3800) {
  const text = cleanText(body);
  if (!text) {
    return [];
  }
  return splitByLength(text, maxLen);
}

export async function sendWhatsAppTextChunked({
  to,
  body,
  replyToMessageId = "",
  previewUrl = false,
  maxLen = 3800,
  integration = {}
}) {
  const chunks = splitWhatsAppMessage(body, maxLen);
  if (!chunks.length) {
    return [];
  }

  const deliveries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const delivery = await sendWhatsAppText({
      to,
      body: chunks[index],
      replyToMessageId: index === 0 ? replyToMessageId : "",
      previewUrl: index === 0 ? previewUrl : false,
      integration
    });
    deliveries.push(delivery);
  }

  return deliveries;
}

export async function sendTypingIndicator(inboundMessageId, integration = {}) {
  if (!inboundMessageId) {
    return null;
  }

  const runtime = resolveIntegration(integration);
  if (runtime.provider !== "meta") {
    return null;
  }

  if (!runtime.accessToken || !runtime.phoneNumberId) {
    return null;
  }

  const payload = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: inboundMessageId,
    typing_indicator: { type: "text" }
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${runtime.graphVersion}/${runtime.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const apiError = await readMetaApiError(response, "Typing indicator failed");
      console.warn(apiError.message);
      return null;
    }

    return response.json();
  } catch (error) {
    console.warn(`Typing indicator error: ${error.message}`);
    return null;
  }
}

export function outboundDedupKey(prefix, to, body, inboundMessageId = "") {
  return `${prefix}:${to}:${inboundMessageId}:${hashText(body)}`;
}

export function autoWhitelistPhone(_phone) {
  return Promise.resolve({ ok: false, reason: "manual_only" });
}
