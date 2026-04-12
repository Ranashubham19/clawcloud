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

export function sanitizeForWhatsApp(value) {
  let text = String(value || "");
  if (!text.trim()) {
    return "";
  }

  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_match, body) => body.trim());
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  text = text.replace(/(^|\s)__([^_\n]+)__(?=\s|$|[.,!?;:])/g, "$1$2");
  text = text.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_m, label, url) => {
    const cleanLabel = label.trim();
    if (!cleanLabel) return url;
    if (cleanLabel === url) return url;
    return `${cleanLabel} (${url})`;
  });
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^(\s*)[-*+]\s+/gm, "$1• ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+\n/g, "\n");

  return text.trim();
}

export function toModelText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}
