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

export function extractTelegramInbound(payload) {
  const message = payload?.message || payload?.edited_message;
  if (!message) return null;

  const from = message.from || {};
  const chat = message.chat || {};

  return {
    provider: "telegram",
    from: String(from.id || ""),
    chatId: String(chat.id || ""),
    text: cleanText(message.text || message.caption || ""),
    profileName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "",
    messageId: `telegram:${message.message_id || Date.now()}`,
    timestamp: String(message.date || "")
  };
}
