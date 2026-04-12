const DEVANAGARI_RE = /\p{Script=Devanagari}/u;

const HINGLISH_HINTS = new Set([
  "acha",
  "achha",
  "agar",
  "aap",
  "apko",
  "apna",
  "bata",
  "batao",
  "bataiye",
  "chahiye",
  "hai",
  "hain",
  "hoga",
  "hogi",
  "hua",
  "hui",
  "karo",
  "kar",
  "karna",
  "kaise",
  "kab",
  "kaha",
  "kahaan",
  "kya",
  "kyu",
  "kyun",
  "lekin",
  "mujhe",
  "nahi",
  "nahin",
  "pata",
  "samjhao",
  "samjha",
  "tha",
  "thi",
  "theek",
  "thik",
  "toh",
  "tum",
  "yaar",
  "yeh"
]);

function latinTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z']+/g) || [];
}

function countHinglishHints(value) {
  return latinTokens(value).filter((token) => HINGLISH_HINTS.has(token)).length;
}

export function detectExplicitLanguageRequest(value) {
  const text = String(value || "");
  if (!text.trim()) {
    return "";
  }

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+english\b/i.test(text) ||
    /\benglish\s+(me|mein)\b/i.test(text)
  ) {
    return "english";
  }

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+hinglish\b/i.test(text) ||
    /\bhinglish\s+(me|mein)\b/i.test(text)
  ) {
    return "hinglish";
  }

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+hindi\b/i.test(text) ||
    /\bhindi\s+(me|mein)\b/i.test(text) ||
    /हिंदी\s+में/u.test(text)
  ) {
    return "hindi";
  }

  return "";
}

export function detectLanguageStyle(value) {
  const explicit = detectExplicitLanguageRequest(value);
  if (explicit) {
    return explicit;
  }

  const text = String(value || "").trim();
  if (!text) {
    return "english";
  }

  if (DEVANAGARI_RE.test(text)) {
    return "hindi";
  }

  const tokens = latinTokens(text);
  const hintCount = countHinglishHints(text);
  if (hintCount >= 2 || (hintCount >= 1 && tokens.length <= 8)) {
    return "hinglish";
  }

  return "english";
}

export function languageLabel(style) {
  switch (style) {
    case "hindi":
      return "Hindi in Devanagari script";
    case "hinglish":
      return "Hinglish in Roman script";
    default:
      return "English";
  }
}

export function languageInstruction(style) {
  switch (style) {
    case "hindi":
      return "Reply only in Hindi using Devanagari script. Do not switch to English unless the user explicitly asks.";
    case "hinglish":
      return "Reply only in Hinglish or Roman Urdu using Roman script. Do not use Devanagari. Do not switch to pure English unless the user explicitly asks.";
    default:
      return "Reply only in English. Do not switch to Hindi, Hinglish, Urdu, or Devanagari unless the user explicitly asks.";
  }
}

export function isLanguageCompatible(text, style) {
  const value = String(text || "").trim();
  if (!value) {
    return true;
  }

  const hasDevanagari = DEVANAGARI_RE.test(value);
  const hinglishHints = countHinglishHints(value);

  if (style === "hindi") {
    return hasDevanagari;
  }

  if (style === "hinglish") {
    if (hasDevanagari) {
      return false;
    }
    if (value.length < 40) {
      return true;
    }
    return hinglishHints >= 1;
  }

  if (hasDevanagari) {
    return false;
  }

  return hinglishHints < 2;
}
