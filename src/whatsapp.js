import crypto from "node:crypto";
import { config, requireConfig } from "./config.js";
import { hashText } from "./lib/text.js";

export function verifyWhatsAppSignature(rawBody, signatureHeader) {
  if (!config.whatsappAppSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", config.whatsappAppSecret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader.slice("sha256=".length)),
    Buffer.from(expected)
  );
}

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker", "voice"];

function extractMedia(message) {
  for (const kind of MEDIA_TYPES) {
    if (message.type === kind && message[kind]) {
      const m = message[kind];
      return {
        mediaId: m.id || "",
        mediaType: kind,
        mimeType: m.mime_type || "",
        caption: m.caption || "",
        filename: m.filename || ""
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
          filename: media?.filename || ""
        });
      }
    }
  }

  return found;
}

export async function downloadWhatsAppMedia(mediaId) {
  requireConfig("WHATSAPP_ACCESS_TOKEN", config.whatsappAccessToken);

  const infoRes = await fetch(
    `https://graph.facebook.com/${config.whatsappGraphVersion}/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${config.whatsappAccessToken}` }
    }
  );

  if (!infoRes.ok) {
    const details = await infoRes.text();
    throw new Error(`Media info error ${infoRes.status}: ${details.slice(0, 200)}`);
  }

  const info = await infoRes.json();

  const dataRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${config.whatsappAccessToken}` }
  });

  if (!dataRes.ok) {
    throw new Error(`Media download error ${dataRes.status}`);
  }

  const buffer = Buffer.from(await dataRes.arrayBuffer());
  return {
    data: buffer,
    mimeType: info.mime_type || "application/octet-stream"
  };
}

export async function sendWhatsAppText({
  to,
  body,
  replyToMessageId = "",
  previewUrl = false
}) {
  if (config.whatsappProvider === "aisensy") {
    return sendAiSensyText({ to, body });
  }

  requireConfig("WHATSAPP_ACCESS_TOKEN", config.whatsappAccessToken);
  requireConfig("WHATSAPP_PHONE_NUMBER_ID", config.whatsappPhoneNumberId);

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
    `https://graph.facebook.com/${config.whatsappGraphVersion}/${config.whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsappAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const details = await response.text();
    let reason = `WhatsApp API error ${response.status}: ${details}`;

    // Translate common API errors into plain English
    let parsed = {};
    try { parsed = JSON.parse(details); } catch { /* ignore */ }
    const code = parsed?.error?.code;

    if (code === 131030 || details.includes("not in allowed list")) {
      reason = "RECIPIENT_NOT_ALLOWED";
    } else if (details.includes("invalid_parameter") || details.includes("Invalid parameter")) {
      reason = "INVALID_PHONE";
    } else if (response.status === 429) {
      reason = "RATE_LIMITED";
    }

    throw new Error(reason);
  }

  return response.json();
}

function asAiSensyDestination(to) {
  const value = String(to || "").trim();
  if (value.startsWith("+")) {
    return value;
  }

  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : value;
}

export function buildAiSensyCampaignPayload({ to, body, userName = "" }) {
  return {
    apiKey: config.aisensyApiKey,
    campaignName: config.aisensyCampaignName,
    destination: asAiSensyDestination(to),
    userName: userName || config.aisensyDefaultUserName,
    source: config.aisensySource,
    templateParams: [String(body || "")],
    tags: ["claw-cloud-ai"],
    attributes: {
      claw_cloud_provider: "aisensy",
      claw_cloud_last_reply: String(body || "").slice(0, 512)
    }
  };
}

async function sendAiSensyText({ to, body }) {
  requireConfig("AISENSY_API_KEY", config.aisensyApiKey);
  requireConfig("AISENSY_CAMPAIGN_NAME", config.aisensyCampaignName);

  const response = await fetch(config.aisensyApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildAiSensyCampaignPayload({ to, body }))
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

function splitByLength(text, maxLen) {
  if (text.length <= maxLen) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }

    if (para.length <= maxLen) {
      buffer = para;
      continue;
    }

    const sentences = para.split(/(?<=[.!?])\s+/);
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
          for (let i = 0; i < word.length; i += maxLen) {
            chunks.push(word.slice(i, i + maxLen));
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
  const text = String(body || "").trim();
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
  maxLen = 3800
}) {
  const chunks = splitWhatsAppMessage(body, maxLen);
  if (!chunks.length) {
    return [];
  }

  const deliveries = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const delivery = await sendWhatsAppText({
      to,
      body: chunks[i],
      replyToMessageId: i === 0 ? replyToMessageId : "",
      previewUrl: i === 0 ? previewUrl : false
    });
    deliveries.push(delivery);
  }

  return deliveries;
}

export async function sendTypingIndicator(inboundMessageId) {
  if (!inboundMessageId) {
    return null;
  }
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
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
      `https://graph.facebook.com/${config.whatsappGraphVersion}/${config.whatsappPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsappAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.warn(`Typing indicator failed ${response.status}: ${details}`);
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

/**
 * No-op: Meta's WhatsApp test numbers require recipients to be added manually
 * through the Developer Console UI. There is no API endpoint for this.
 * On production/live numbers there is no restriction at all.
 */
export function autoWhitelistPhone(_phone) {
  return Promise.resolve({ ok: false, reason: "manual_only" });
}
