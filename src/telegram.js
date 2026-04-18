const TELEGRAM_API = "https://api.telegram.org";

function cleanText(value) {
  return String(value || "").trim();
}

export async function setTelegramWebhook(token, webhookUrl) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] })
  });
  return response.json();
}

export async function deleteTelegramWebhook(token) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/deleteWebhook`, {
    method: "POST"
  });
  return response.json();
}

export async function getTelegramBotInfo(token) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
  return response.json();
}

export async function sendTelegramMessage(token, chatId, text) {
  const chunks = splitMessage(cleanText(text));
  for (const chunk of chunks) {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk })
    });
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
