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

/**
 * Convert model output (Markdown) into WhatsApp-native formatting.
 *
 * WhatsApp renders:
 *   *text*   → bold
 *   _text_   → italic
 *   ~text~   → strikethrough
 *   `text`   → monospace
 *   Blank lines between paragraphs → visible spacing
 *
 * We convert common Markdown to these equivalents instead of stripping them.
 */
export function sanitizeForWhatsApp(value) {
  let text = String(value || "");
  if (!text.trim()) return "";

  // 1. Extract fenced code-block contents (remove fences, keep body)
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_match, body) => body.trim());

  // 2. Convert Markdown headings → *bold heading* + ensure blank line after
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // 3. Convert Markdown list bullets (* item  /  + item  /  - item) → • item
  //    Must run BEFORE bold conversion so "* item" isn't confused with "*bold*"
  text = text.replace(/^(\s*)[*+]\s+/gm, "$1• ");
  text = text.replace(/^(\s*)-\s+/gm, "$1• ");

  // 4. Convert triple Markdown emphasis → WhatsApp bold
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "*$1*");

  // 5. Convert double Markdown bold → WhatsApp bold
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");

  // 6. Convert double-underscore Markdown bold → WhatsApp italic
  text = text.replace(/(^|\s)__([^_\n]+)__(?=\s|$|[.,!?;:])/g, "$1_$2_");

  // 7. Convert Markdown links → readable plain text
  text = text.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_m, label, url) => {
    const cleanLabel = label.trim();
    if (!cleanLabel || cleanLabel === url) return url;
    return `${cleanLabel} (${url})`;
  });

  // 8. Remove horizontal rules  ---  ===  ***
  text = text.replace(/^\s*[-*_=]{3,}\s*$/gm, "");

  // 9. Remove blockquote markers
  text = text.replace(/^\s*>\s?/gm, "");

  // 10. Ensure a blank line after every *heading* line for visual breathing room
  text = text.replace(/^(\*[^*\n]+\*)\s*\n(?!\n)/gm, "$1\n\n");

  // 11. Collapse 3+ consecutive newlines down to 2 (one blank line)
  text = text.replace(/\n{3,}/g, "\n\n");

  // 12. Strip trailing spaces on each line
  text = text.replace(/[ \t]+\n/g, "\n");

  return text.trim();
}

export function cleanUserFacingText(value) {
  let text = sanitizeForWhatsApp(value);
  if (!text) return "";

  // Strip trailing citation markers added by some models
  text = text.replace(/\s*\[cite:[\s\S]*$/i, "").trim();

  const lines = text.split(/\r?\n/);
  const cleanedLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Preserve blank lines — they create the visual spacing between sections
    if (!line) {
      // Only push a blank if the previous line wasn't already blank (no double-blanks)
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    // Strip internal tool-call leakage lines
    if (/^\[TOOL_CALLS\]/i.test(line)) continue;
    if (
      /^(web_search|lookup_contact|save_contact|get_recent_history|search_history|send_whatsapp_message|create_reminder|list_reminders|cancel_reminder|list_contacts|list_chat_threads)\s*\(/i.test(
        line
      )
    )
      continue;
    if (/^\(?using (google )?web search/i.test(line) || /^\(?searching\b/i.test(line)) continue;
    if (/^(i('| wi)ll|let me)\s+(check|look up|search)\b/i.test(line)) continue;
    if (/^here is the function call/i.test(line)) continue;

    cleanedLines.push(line);
  }

  // Drop trailing blank lines
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
