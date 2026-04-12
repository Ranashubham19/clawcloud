import { config } from "./config.js";
import {
  isLanguageCompatible,
  languageInstruction,
  languageLabel
} from "./lib/language.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

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
    "You are an advanced AI assistant embedded in WhatsApp.",
    `LANGUAGE RULE — ABSOLUTE: You MUST reply entirely in ${langLabel}. This overrides everything else.`,
    langInstruct,
    `Every single sentence of your response must be in ${langLabel}. Do NOT mix languages or slip into English unless ${langLabel} is English.`,
    "FORMATTING RULE: Plain text only. No Markdown, no asterisks, no hashtags, no backticks. Use '-' for bullets if needed.",
    "ANSWER DEPTH RULE: Give a complete, accurate answer. Cover the key point first, then short useful context.",
    "FRESHNESS RULE: You have access to live Google Search. Use it for time-sensitive or current-events questions.",
    "SPEED RULE: Be direct. No preamble, no 'Great question!', no meta-commentary.",
    "Return the final answer only. Never mention searching, tools, function calls, or internal workflow.",
    "Never output raw JSON, tool syntax, or placeholder text."
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
      maxOutputTokens: Math.max(180, Math.min(maxOutputTokens, 900)),
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

    return text || null;
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

function mediaPrompt(mediaType, mimeType, caption) {
  if (caption) return caption;
  if (mediaType === "audio" || mediaType === "voice" || mimeType.startsWith("audio/")) {
    return "Transcribe this audio message fully and accurately. Then respond to anything the person said or asked.";
  }
  if (mediaType === "video" || mimeType.startsWith("video/")) {
    return "Describe what is happening in this video. Then respond to anything being asked or shown.";
  }
  if (mediaType === "document" || mimeType === "application/pdf") {
    return "Read this document/PDF fully. Summarize the key points and answer any questions the user might have about it.";
  }
  if (mediaType === "image" || mimeType.startsWith("image/")) {
    return "Describe this image in detail. Identify any text, objects, people, or data visible. Answer any implied questions.";
  }
  return "Process this file and describe its contents clearly.";
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

  const remainingMs = deadlineAt ? deadlineAt - Date.now() : config.geminiTimeoutMs;
  if (remainingMs < 1000) return null;

  const langLabel = languageLabel(languageStyle);
  const langInstruct = languageInstruction(languageStyle);

  const systemInstruction = [
    `You are an advanced AI assistant in WhatsApp.`,
    `LANGUAGE RULE — ABSOLUTE: Reply entirely in ${langLabel}. ${langInstruct}`,
    "FORMATTING RULE: Plain text only. No Markdown, no asterisks, no hashtags, no backticks.",
    "Give a complete, accurate, and helpful response.",
    "Never mention tools, internal workflow, or that you are processing a file."
  ].join("\n");

  const userText = mediaPrompt(mediaType, mimeType, caption);
  const filePart = {
    inlineData: {
      mimeType,
      data: mediaData.toString("base64")
    }
  };

  const textParts = [];
  if (filename) textParts.push({ text: `File: ${filename}\n` });
  textParts.push({ text: userText });

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
      maxOutputTokens: 1200,
      candidateCount: 1,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const { signal, cancel } = createTimeoutSignal(
    Math.min(config.geminiTimeoutMs, remainingMs)
  );

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
        ? `Gemini media timed out after ${config.geminiTimeoutMs}ms`
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
  if (answer && isLanguageCompatible(answer, languageStyle)) {
    return answer;
  }

  return null;
}
