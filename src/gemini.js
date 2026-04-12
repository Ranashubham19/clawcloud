import { config } from "./config.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_LIVE_MODEL = "gemini-2.0-flash";

export function hasGeminiProvider() {
  return Boolean(config.geminiApiKey);
}

export async function geminiSearchAnswer({ query, languageHint = "" }) {
  if (!config.geminiApiKey) {
    return null;
  }

  const systemInstruction = [
    "You are an advanced AI assistant embedded in WhatsApp.",
    "LANGUAGE RULE: Reply in the exact same language as the user's question. If the question is in Hindi, reply in Hindi. If in English, reply in English. If in Hinglish, reply in Hinglish.",
    "FORMATTING RULE: Plain text only. No Markdown, no asterisks, no hashtags, no backticks. Use '-' for bullets if needed. Keep paragraphs short.",
    "ANSWER DEPTH RULE: Give a complete, thorough answer. Cover all important aspects. Never give a one-liner for a non-trivial question.",
    "FRESHNESS RULE: You have access to live Google Search. Always use it to get the latest information before answering. Do not rely on training data for anything time-sensitive.",
    "LENGTH RULE: Keep the answer under 2500 characters so it fits in one WhatsApp message.",
    languageHint ? `The user's language is: ${languageHint}.` : ""
  ].filter(Boolean).join("\n");

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: query }]
      }
    ],
    tools: [
      { google_search: {} }
    ],
    generation_config: {
      temperature: 0.0,
      max_output_tokens: 900,
      candidate_count: 1
    }
  };

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_LIVE_MODEL}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
