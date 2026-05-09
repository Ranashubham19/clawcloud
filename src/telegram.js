import { describeMediaAttachment, inferMimeType } from "./media.js";

const TELEGRAM_API = "https://api.telegram.org";

function cleanText(value) {
  return String(value || "").trim();
}

function escapeTelegramHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTelegramHtml(value) {
  const placeholders = [];
  const prepared = String(value || "").replace(
    /\[\[TEL_CITE:(\d+)\|([^[\]]+)\]\]/g,
    (_match, number, url) => {
      const token = `TELCITEPLACEHOLDER${placeholders.length}`;
      placeholders.push({
        token,
        number,
        url
      });
      return token;
    }
  );

  let formatted = escapeTelegramHtml(prepared).replace(
    /\*([^*\n]{1,160})\*/g,
    "<b>$1</b>"
  );

  for (const placeholder of placeholders) {
    formatted = formatted.replace(
      placeholder.token,
      `<a href="${escapeTelegramHtmlAttribute(placeholder.url)}">[${placeholder.number}]</a>`
    );
  }

  return formatted;
}

async function readTelegramResponse(response, action) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.description || `Telegram ${action} failed with status ${response.status}.`
    );
  }
  return payload || { ok: true };
}

export async function setTelegramWebhook(token, webhookUrl) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] })
  });
  return readTelegramResponse(response, "setWebhook");
}

export async function deleteTelegramWebhook(token) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/deleteWebhook`, {
    method: "POST"
  });
  return readTelegramResponse(response, "deleteWebhook");
}

export async function getTelegramBotInfo(token) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
  return readTelegramResponse(response, "getMe");
}

export async function getTelegramWebhookInfo(token) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
  return readTelegramResponse(response, "getWebhookInfo");
}

export async function sendTelegramChatAction(token, chatId, action = "typing", options = {}) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendChatAction`, {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action
    })
  });
  return readTelegramResponse(response, "sendChatAction");
}

export async function sendTelegramMessage(token, chatId, text) {
  const chunks = splitMessage(cleanText(text));
  for (const chunk of chunks) {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramHtml(chunk),
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true
        }
      })
    });
    await readTelegramResponse(response, "sendMessage");
  }
}

function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const lastBreak = text.lastIndexOf("\n", end);
      if (lastBreak > start) end = lastBreak;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

const TELEGRAM_MEDIA_TYPES = ["photo", "video", "audio", "voice", "document", "sticker", "animation", "video_note"];

function inferTelegramMimeType(kind, item = {}) {
  let fallbackMime = "";
  if (kind === "photo") fallbackMime = "image/jpeg";
  if (kind === "voice") fallbackMime = "audio/ogg";
  if (kind === "video_note") fallbackMime = "video/mp4";
  if (kind === "animation") fallbackMime = "image/gif";
  if (kind === "sticker") {
    fallbackMime = item?.is_video
      ? "video/webm"
      : item?.is_animated
        ? "application/x-tgsticker"
        : "image/webp";
  }

  return inferMimeType({
    mimeType: item?.mime_type || fallbackMime,
    filename: item?.file_name || "",
    mediaType: kind
  });
}

function extractTelegramMedia(message) {
  for (const kind of TELEGRAM_MEDIA_TYPES) {
    if (message[kind]) {
      const item = Array.isArray(message[kind])
        ? message[kind][message[kind].length - 1]
        : message[kind];
      const mimeType = inferTelegramMimeType(kind, item);
      return {
        mediaType: kind,
        fileId: item?.file_id || "",
        mimeType,
        filename: item?.file_name || "",
        duration: item?.duration || 0
      };
    }
  }
  return null;
}

export async function downloadTelegramMedia(token, fileId) {
  // Step 1: resolve file_path
  const infoRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!infoRes.ok) throw new Error(`Telegram getFile failed: ${infoRes.status}`);
  const info = await infoRes.json();
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile: no file_path returned");

  // Step 2: download the actual bytes
  const dlRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!dlRes.ok) throw new Error(`Telegram file download failed: ${dlRes.status}`);
  const arrayBuffer = await dlRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function telegramMediaLabel(mediaType, filename = "", mimeType = "") {
  return describeMediaAttachment({ mediaType, filename, mimeType });
}

export function extractTelegramInbound(payload) {
  const message = payload?.message || payload?.edited_message;
  if (!message) return null;

  const from = message.from || {};
  const chat = message.chat || {};
  const caption = cleanText(message.caption || "");
  const textContent = cleanText(message.text || "");
  const media = extractTelegramMedia(message);

  let text = textContent || caption;
  let mediaType = "";
  let mimeType = "";
  let filename = "";
  let fileId = "";

  if (media) {
    mediaType = media.mediaType;
    mimeType = media.mimeType;
    filename = media.filename;
    fileId = media.fileId;
    if (!text) {
      text = `[User sent a ${telegramMediaLabel(mediaType, filename, mimeType)}]`;
    } else {
      text = `[User sent a ${telegramMediaLabel(mediaType, filename, mimeType)}] ${text}`;
    }
  }

  return {
    provider: "telegram",
    from: String(from.id || ""),
    chatId: String(chat.id || ""),
    text,
    caption: media ? (textContent || caption) : "",
    profileName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "",
    messageId: `telegram:${chat.id || from.id || "unknown"}:${message.message_id || Date.now()}`,
    timestamp: String(message.date || ""),
    mediaType,
    mimeType,
    filename,
    fileId
  };
}
