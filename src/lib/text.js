import crypto from "node:crypto";

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stripDecorativeSymbols(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\uFE0F/g, "")
    .replace(/[•◦▪●]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[→←↔⇒➜➝➔]/g, "->")
    .replace(/[\u2500-\u257F\u2580-\u259F]/g, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "");
}

export function sanitizeForWhatsApp(value) {
  let text = stripDecorativeSymbols(value);
  if (!text.trim()) return "";

  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_match, body) => body.trim());
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  text = text.replace(/^(\s*)[*+]\s+/gm, "$1- ");
  text = text.replace(/^(\s*)-\s+/gm, "$1- ");
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "*$1*");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  text = text.replace(/(^|\s)__([^_\n]+)__(?=\s|$|[.,!?;:])/g, "$1_$2_");
  text = text.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_m, label, url) => {
    const cleanLabel = label.trim();
    if (!cleanLabel || cleanLabel === url) return url;
    return `${cleanLabel} (${url})`;
  });
  text = text.replace(/^\s*[-*_=]{3,}\s*$/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/\*([^*\n]{90,})\*/g, "$1");
  text = text.replace(/^(\*[^*\n]+\*)\s*\n(?!\n)/gm, "$1\n\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+\n/g, "\n");

  return text.trim();
}

export function cleanUserFacingText(value) {
  let text = sanitizeForWhatsApp(value);
  if (!text) return "";

  text = text.replace(/\s*\[cite:[\s\S]*$/i, "").trim();

  const lines = text.split(/\r?\n/);
  const cleanedLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    if (/^\[TOOL_CALLS\]/i.test(line)) continue;
    if (
      /^(web_search|lookup_contact|save_contact|get_recent_history|search_history|send_whatsapp_message|create_reminder|list_reminders|cancel_reminder|list_contacts|list_chat_threads)\s*\(/i.test(
        line
      )
    ) {
      continue;
    }
    if (/^\(?using (google )?web search/i.test(line) || /^\(?searching\b/i.test(line)) continue;
    if (/^(i('| wi)ll|let me)\s+(check|look up|search)\b/i.test(line)) continue;
    if (/^here is the function call/i.test(line)) continue;

    cleanedLines.push(line);
  }

  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] === "") {
    cleanedLines.pop();
  }

  text = cleanedLines.join("\n");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export function toModelText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}
