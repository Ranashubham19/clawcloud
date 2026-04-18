import { config } from "./config.js";
import {
  isLanguageCompatible,
  languageInstruction,
  languageLabel
} from "./lib/language.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// MIME types Gemini natively understands (inline base64)
const GEMINI_SUPPORTED_MIME = new Set([
  // Images
  "image/jpeg", "image/jpg", "image/png", "image/gif",
  "image/webp", "image/heic", "image/heif", "image/bmp",
  // Audio
  "audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg",
  "audio/aiff", "audio/x-aiff", "audio/aac", "audio/x-aac",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/opus",
  "audio/amr", "audio/x-amr",
  // Video
  "video/mp4", "video/mpeg", "video/mpg", "video/mov",
  "video/quicktime", "video/avi", "video/x-msvideo",
  "video/x-flv", "video/webm", "video/wmv", "video/3gpp",
  "video/3gp",
  // Documents
  "application/pdf",
  "text/plain", "text/html", "text/css", "text/csv",
  "text/markdown", "text/xml", "text/rtf", "application/rtf",
  "application/json"
]);

// Human-readable format names for unsupported types
const UNSUPPORTED_FORMAT_NAMES = {
  "application/msword": "Word document (.doc)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document (.docx)",
  "application/vnd.ms-excel": "Excel spreadsheet (.xls)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel spreadsheet (.xlsx)",
  "application/vnd.ms-powerpoint": "PowerPoint (.ppt)",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint (.pptx)",
  "application/zip": "ZIP archive",
  "application/x-zip-compressed": "ZIP archive",
  "application/x-rar-compressed": "RAR archive",
  "application/octet-stream": "binary file"
};

/**
 * Strip MIME parameters (e.g. "audio/ogg; codecs=opus" → "audio/ogg")
 * and normalise aliases so Gemini always receives a clean type.
 */
export function normalizeMimeType(raw) {
  if (!raw) return "application/octet-stream";
  const base = raw.split(";")[0].trim().toLowerCase();
  const aliases = {
    "audio/x-wav": "audio/wav",
    "audio/x-aiff": "audio/aiff",
    "audio/x-aac": "audio/aac",
    "audio/x-flac": "audio/flac",
    "audio/x-m4a": "audio/aac",
    "audio/mp4": "audio/aac",
    "audio/opus": "audio/ogg",
    "image/jpg": "image/jpeg",
    "video/quicktime": "video/mov",
    "video/x-msvideo": "video/avi",
    "video/3gp": "video/3gpp"
  };
  return aliases[base] || base;
}

export function isMimeSupported(mimeType) {
  return GEMINI_SUPPORTED_MIME.has(normalizeMimeType(mimeType));
}

export function unsupportedFormatName(mimeType) {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return UNSUPPORTED_FORMAT_NAMES[base] || base;
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    }
  };
}

export function hasGeminiProvider() {
  return Boolean(config.geminiApiKey);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSourceDomain(uri) {
  const raw = cleanText(uri).replace(/^www\./i, "");
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) {
    return raw.toLowerCase();
  }

  try {
    return new URL(uri).hostname.replace(/^www\./i, "").trim();
  } catch {
    return "";
  }
}

function isGroundingRedirectUrl(uri) {
  try {
    const url = new URL(uri);
    return /grounding-api-redirect/i.test(url.pathname);
  } catch {
    return false;
  }
}

function sourceFallbackUrl(source = {}) {
  const domain = cleanText(source.domain);
  const title = cleanText(source.title);
  const query = [domain ? `site:${domain}` : "", title].filter(Boolean).join(" ");
  if (!query) {
    return cleanText(source.uri);
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

const resolvedGroundingUrlCache = new Map();

async function requestResolvedUrl(uri, method, timeoutMs) {
  const { signal, cancel } = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(uri, {
      method,
      redirect: "follow",
      signal,
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });

    const finalUrl = cleanText(response?.url || "");
    return finalUrl || cleanText(uri);
  } catch {
    return "";
  } finally {
    cancel();
  }
}

async function resolveGroundingSourceUrl(uri, timeoutMs = 1800) {
  const value = cleanText(uri);
  if (!value) {
    return "";
  }

  if (!isGroundingRedirectUrl(value)) {
    return value;
  }

  if (resolvedGroundingUrlCache.has(value)) {
    return resolvedGroundingUrlCache.get(value);
  }

  let resolved = await requestResolvedUrl(value, "HEAD", timeoutMs);
  if (!resolved || isGroundingRedirectUrl(resolved)) {
    resolved = await requestResolvedUrl(value, "GET", timeoutMs);
  }

  const finalUrl = resolved && !isGroundingRedirectUrl(resolved) ? resolved : "";
  resolvedGroundingUrlCache.set(value, finalUrl);
  return finalUrl;
}

export async function resolveGeminiGroundingSources(sources, timeoutMs = 1800) {
  const items = Array.isArray(sources) ? sources : [];
  if (!items.length) {
    return [];
  }

  return Promise.all(
    items.map(async (source) => {
      const resolvedUri = await resolveGroundingSourceUrl(source.uri, timeoutMs);
      const nextUri = resolvedUri || sourceFallbackUrl(source);
      return {
        ...source,
        uri: nextUri,
        domain:
          normalizeSourceDomain(resolvedUri) ||
          normalizeSourceDomain(source.title) ||
          source.domain
      };
    })
  );
}

function normalizeGroundingSupports(candidate) {
  const supports = candidate?.groundingMetadata?.groundingSupports;
  return Array.isArray(supports) ? supports : [];
}

export function extractGeminiGroundingSources(candidate, maxSources = 6) {
  const grounding = candidate?.groundingMetadata || {};
  const chunks = Array.isArray(grounding.groundingChunks)
    ? grounding.groundingChunks
    : [];

  if (!chunks.length) {
    return [];
  }

  const preferredIndices = [];
  const supports = Array.isArray(grounding.groundingSupports)
    ? grounding.groundingSupports
    : [];

  for (const support of supports) {
    for (const index of support?.groundingChunkIndices || []) {
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < chunks.length &&
        !preferredIndices.includes(index)
      ) {
        preferredIndices.push(index);
      }
    }
  }

  const orderedIndices = preferredIndices.slice();
  for (let index = 0; index < chunks.length; index += 1) {
    if (!orderedIndices.includes(index)) {
      orderedIndices.push(index);
    }
  }

  const seenUris = new Set();
  const sources = [];

  for (const index of orderedIndices) {
    const chunk = chunks[index] || {};
    const web = chunk?.web || {};
    const uri = cleanText(web.uri || web.url || chunk.uri || "");
    if (!uri || seenUris.has(uri)) {
      continue;
    }

    seenUris.add(uri);

    const domain = normalizeSourceDomain(uri);
    const title = cleanText(web.title || domain || uri);
    sources.push({
      index,
      title,
      uri,
      domain
    });

    if (sources.length >= maxSources) {
      break;
    }
  }

  return sources;
}

async function requestGeminiSearchAnswer({
  query,
  languageStyle,
  maxOutputTokens = 550,
  timeoutMs = config.geminiTimeoutMs
}) {
  if (!config.geminiApiKey) {
    return null;
  }

  const langLabel = languageLabel(languageStyle);
  const langInstruct = languageInstruction(languageStyle);

  const systemInstruction = [
    "You are an advanced AI assistant embedded in WhatsApp with access to live Google Search.",
    `LANGUAGE RULE — ABSOLUTE: Reply entirely in ${langLabel}. ${langInstruct}. Every sentence must be in ${langLabel}.`,
    "FORMATTING RULE: Use WhatsApp format. *bold* for headings/key terms. Numbered lists for steps or ranked items. • bullets for lists. ONE blank line between sections. No Markdown (##, **, ```).",
    "ACCURACY RULE: Use Google Search to get the most up-to-date, factual information. If the question asks for a list (e.g. '10 conditions', '5 demands', '3 reasons'), provide ALL items numbered clearly.",
    "DEPTH RULE: For news/events questions, include: what happened, who is involved, key details, current status. Be specific — use real names, numbers, dates.",
    "SPEED RULE: Answer directly. No preamble, no 'Great question!', no 'Let me search for that'. Start with the answer immediately.",
    "Never mention searching, tools, or internal workflow. Never output raw JSON or placeholder text.",
    "Do not add citation markers, footnotes, or a sources section in the answer text."
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: query }]
      }
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: Math.max(300, Math.min(maxOutputTokens, 1500)),
      candidateCount: 1,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const { signal, cancel } = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.geminiApiKey
        },
        body: JSON.stringify(payload),
        signal
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.warn(`Gemini API error ${response.status}: ${details.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();

    if (!text) {
      return null;
    }

    const rawSources = extractGeminiGroundingSources(candidate);
    const sources = await resolveGeminiGroundingSources(rawSources);

    return {
      text,
      sources,
      supports: normalizeGroundingSupports(candidate)
    };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `Gemini request timed out after ${timeoutMs}ms`
        : error.message;
    console.warn(`Gemini search error: ${message}`);
    return null;
  } finally {
    cancel();
  }
}

function mediaPrompt(mediaType, mimeType, caption, filename) {
  // If the user wrote a caption, that IS the question — answer it using the file as context
  if (caption && caption.trim()) {
    return caption.trim();
  }

  const mime = normalizeMimeType(mimeType);

  // Audio / voice
  if (mediaType === "audio" || mediaType === "voice" || mime.startsWith("audio/")) {
    return (
      "This is an audio message. Please:\n" +
      "1. Transcribe every word spoken, accurately and completely.\n" +
      "2. If the person asked something or said something needing a response, reply to it directly.\n" +
      "3. If it is music or ambient sound, describe what you hear."
    );
  }

  // Video
  if (mediaType === "video" || mime.startsWith("video/")) {
    return (
      "This is a video. Please:\n" +
      "1. Describe what is happening scene by scene.\n" +
      "2. Transcribe any speech or important text visible on screen.\n" +
      "3. If the video contains a question or request, answer it."
    );
  }

  // PDF
  if (mime === "application/pdf") {
    const name = filename ? `"${filename}"` : "this PDF";
    return (
      `Please read ${name} fully and:\n` +
      "1. Give a clear summary of the main content.\n" +
      "2. List any key facts, figures, or decisions.\n" +
      "3. If it is a bill, contract, or form, highlight the most important parts."
    );
  }

  // HTML / web page
  if (mime === "text/html") {
    return (
      "This is an HTML file. Please:\n" +
      "1. Extract and summarize the main text content.\n" +
      "2. Ignore navigation, ads, and boilerplate.\n" +
      "3. Highlight any important information."
    );
  }

  // CSV / spreadsheet data
  if (mime === "text/csv") {
    return (
      "This is a CSV data file. Please:\n" +
      "1. Describe what data it contains (columns, row count, topic).\n" +
      "2. Highlight notable patterns, totals, or outliers.\n" +
      "3. Answer any questions the user might have about this data."
    );
  }

  // Plain text
  if (mime === "text/plain" || mime === "text/markdown") {
    return (
      "This is a text file. Please read it fully and:\n" +
      "1. Summarize the content.\n" +
      "2. Answer any questions implied by the content."
    );
  }

  // Image (default)
  if (mediaType === "image" || mediaType === "sticker" || mime.startsWith("image/")) {
    return (
      "Please analyse this image and:\n" +
      "1. Describe what you see in detail.\n" +
      "2. Read and transcribe any visible text, numbers, or labels.\n" +
      "3. If it is a document, receipt, screenshot, or chart, extract the key information."
    );
  }

  // Generic fallback
  return (
    `Please process this ${filename ? `file (${filename})` : "file"} and describe its contents clearly and helpfully.`
  );
}

export async function geminiMediaAnswer({
  mediaData,
  mimeType,
  mediaType,
  caption = "",
  filename = "",
  languageStyle = "english",
  deadlineAt = 0
}) {
  if (!config.geminiApiKey) return null;

  const timeoutBudget = config.geminiMediaTimeoutMs;
  const remainingMs = deadlineAt ? Math.min(deadlineAt - Date.now(), timeoutBudget) : timeoutBudget;
  if (remainingMs < 2000) return null;

  const normalizedMime = normalizeMimeType(mimeType);
  const langLabel = languageLabel(languageStyle);
  const langInstruct = languageInstruction(languageStyle);

  const systemInstruction = [
    `You are an advanced AI assistant in WhatsApp.`,
    `LANGUAGE RULE — ABSOLUTE: Reply entirely in ${langLabel}. ${langInstruct}`,
    "FORMATTING RULE: Use WhatsApp format only. *bold* for headings and key terms (single asterisk). Numbered lists for steps. • bullets for lists. ONE blank line between every paragraph and after every heading.",
    "Give a complete, accurate, and helpful response. Never write walls of text — break into readable sections.",
    "Never mention tools, internal workflow, or that you are processing a file.",
    "If this is audio, transcribe every word first, then respond.",
    "If this is an image with text, read all visible text accurately."
  ].join("\n");

  const userPrompt = mediaPrompt(mediaType, mimeType, caption, filename);

  const filePart = {
    inlineData: {
      mimeType: normalizedMime,
      data: mediaData.toString("base64")
    }
  };

  const textParts = [];
  if (filename) textParts.push({ text: `File name: ${filename}\n` });
  textParts.push({ text: userPrompt });

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: "user",
        parts: [filePart, ...textParts]
      }
    ],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 2000,
      candidateCount: 1,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const { signal, cancel } = createTimeoutSignal(remainingMs);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.geminiApiKey
        },
        body: JSON.stringify(payload),
        signal
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.warn(`Gemini media error ${response.status}: ${details.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();

    return text || null;
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? `Gemini media timed out after ${remainingMs}ms`
        : error.message;
    console.warn(`Gemini media error: ${message}`);
    return null;
  } finally {
    cancel();
  }
}

export async function geminiSearchAnswer({
  query,
  languageStyle = "english",
  maxOutputTokens = 550,
  deadlineAt = 0
}) {
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : config.geminiTimeoutMs;
  if (remainingMs < 600) {
    return null;
  }

  const answer = await requestGeminiSearchAnswer({
    query,
    languageStyle,
    maxOutputTokens,
    timeoutMs: Math.min(config.geminiTimeoutMs, remainingMs)
  });
  if (answer?.text && isLanguageCompatible(answer.text, languageStyle)) {
    return answer;
  }

  return null;
}
