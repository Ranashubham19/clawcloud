import { config } from "./config.js";
import {
  isLanguageCompatible,
  languageInstruction,
  languageLabel
} from "./lib/language.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_LIVE_MODEL = "gemini-2.5-flash";

export function hasGeminiProvider() {
  return Boolean(config.geminiApiKey);
}

async function requestGeminiSearchAnswer({
  query,
  languageStyle,
  strict = false
}) {
  if (!config.geminiApiKey) {
    return null;
  }

  const systemInstruction = [
    "You are an advanced AI assistant embedded in WhatsApp.",
    "LANGUAGE RULE: Match only the latest user's language and script.",
    languageInstruction(languageStyle),
    strict
      ? `STRICT MODE: Your entire reply must be in ${languageLabel(languageStyle)}. If you would answer in any other language, regenerate it in ${languageLabel(languageStyle)} before returning it.`
      : "",
    "FORMATTING RULE: Plain text only. No Markdown, no asterisks, no hashtags, no backticks. Use '-' for bullets if needed. Keep paragraphs short.",
    "ANSWER DEPTH RULE: Give a complete, accurate answer. Cover the key point first, then short useful context.",
    "FRESHNESS RULE: You have access to live Google Search. Always use it for time-sensitive questions.",
    "SPEED RULE: Prefer a concise and direct answer when the question is simple.",
    `The required reply language is ${languageLabel(languageStyle)}.`
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
      maxOutputTokens: 700,
      candidateCount: 1,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_LIVE_MODEL}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.geminiApiKey
        },
        body: JSON.stringify(payload)
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
    console.warn(`Gemini search error: ${error.message}`);
    return null;
  }
}

export async function geminiSearchAnswer({
  query,
  languageStyle = "english"
}) {
  const first = await requestGeminiSearchAnswer({
    query,
    languageStyle,
    strict: false
  });
  if (first && isLanguageCompatible(first, languageStyle)) {
    return first;
  }

  const second = await requestGeminiSearchAnswer({
    query,
    languageStyle,
    strict: true
  });
  if (second && isLanguageCompatible(second, languageStyle)) {
    return second;
  }

  return null;
}
