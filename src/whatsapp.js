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

        found.push({
          messageId: message.id,
          from: message.from,
          profileName,
          timestamp: message.timestamp,
          text,
          type: message.type
        });
      }
    }
  }

  return found;
}

export async function sendWhatsAppText({
  to,
  body,
  replyToMessageId = "",
  previewUrl = false
}) {
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
    throw new Error(`WhatsApp API error ${response.status}: ${details}`);
  }

  return response.json();
}

export function outboundDedupKey(prefix, to, body, inboundMessageId = "") {
  return `${prefix}:${to}:${inboundMessageId}:${hashText(body)}`;
}
