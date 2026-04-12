const DEVANAGARI_RE = /\p{Script=Devanagari}/u;
const BENGALI_RE    = /\p{Script=Bengali}/u;
const GUJARATI_RE   = /\p{Script=Gujarati}/u;
const GURMUKHI_RE   = /\p{Script=Gurmukhi}/u;
const KANNADA_RE    = /\p{Script=Kannada}/u;
const MALAYALAM_RE  = /\p{Script=Malayalam}/u;
const TAMIL_RE      = /\p{Script=Tamil}/u;
const TELUGU_RE     = /\p{Script=Telugu}/u;
const ARABIC_RE     = /\p{Script=Arabic}/u;
const THAI_RE       = /\p{Script=Thai}/u;
const SINHALA_RE    = /\p{Script=Sinhala}/u;
const CHINESE_RE    = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const JAPANESE_RE   = /[\u3040-\u30ff\u31f0-\u31ff]/;
const KOREAN_RE     = /[\uac00-\ud7af]/;

// Ordered — checked top-to-bottom during detection
const SCRIPT_DETECTORS = [
  { re: DEVANAGARI_RE, style: "hindi"     },
  { re: BENGALI_RE,    style: "bengali"   },
  { re: GUJARATI_RE,   style: "gujarati"  },
  { re: GURMUKHI_RE,   style: "punjabi"   },
  { re: KANNADA_RE,    style: "kannada"   },
  { re: MALAYALAM_RE,  style: "malayalam" },
  { re: TAMIL_RE,      style: "tamil"     },
  { re: TELUGU_RE,     style: "telugu"    },
  { re: ARABIC_RE,     style: "arabic"    },
  { re: THAI_RE,       style: "thai"      },
  { re: SINHALA_RE,    style: "sinhala"   },
  { re: CHINESE_RE,    style: "chinese"   },
  { re: JAPANESE_RE,   style: "japanese"  },
  { re: KOREAN_RE,     style: "korean"    }
];

// Per-language config: label shown in the prompt, instruction to the model,
// and the script regex used to validate responses (null = Roman script, no check needed)
const LANGUAGE_CONFIG = {
  hindi: {
    label:       "Hindi in Devanagari script",
    instruction: "Reply only in Hindi using Devanagari script. Do not use Roman script or English.",
    scriptRe:    DEVANAGARI_RE
  },
  bengali: {
    label:       "Bengali (বাংলা)",
    instruction: "Reply only in Bengali using Bengali script. Do not switch to English unless explicitly asked.",
    scriptRe:    BENGALI_RE
  },
  gujarati: {
    label:       "Gujarati (ગુજરાતી)",
    instruction: "Reply only in Gujarati using Gujarati script.",
    scriptRe:    GUJARATI_RE
  },
  punjabi: {
    label:       "Punjabi in Gurmukhi script (ਪੰਜਾਬੀ)",
    instruction: "Reply only in Punjabi using Gurmukhi script.",
    scriptRe:    GURMUKHI_RE
  },
  kannada: {
    label:       "Kannada (ಕನ್ನಡ)",
    instruction: "Reply only in Kannada using Kannada script. Do not switch to English unless explicitly asked.",
    scriptRe:    KANNADA_RE
  },
  malayalam: {
    label:       "Malayalam (മലയാളം)",
    instruction: "Reply only in Malayalam using Malayalam script.",
    scriptRe:    MALAYALAM_RE
  },
  tamil: {
    label:       "Tamil (தமிழ்)",
    instruction: "Reply only in Tamil using Tamil script. Do not switch to English unless explicitly asked.",
    scriptRe:    TAMIL_RE
  },
  telugu: {
    label:       "Telugu (తెలుగు)",
    instruction: "Reply only in Telugu using Telugu script. Do not switch to English unless explicitly asked.",
    scriptRe:    TELUGU_RE
  },
  arabic: {
    label:       "Arabic (عربي)",
    instruction: "Reply only in Arabic using Arabic script.",
    scriptRe:    ARABIC_RE
  },
  thai: {
    label:       "Thai (ภาษาไทย)",
    instruction: "Reply only in Thai using Thai script.",
    scriptRe:    THAI_RE
  },
  sinhala: {
    label:       "Sinhala (සිංහල)",
    instruction: "Reply only in Sinhala using Sinhala script.",
    scriptRe:    SINHALA_RE
  },
  chinese: {
    label:       "Chinese (中文)",
    instruction: "Reply only in Chinese using Chinese characters. Match Simplified or Traditional based on the user's input.",
    scriptRe:    CHINESE_RE
  },
  japanese: {
    label:       "Japanese (日本語)",
    instruction: "Reply only in Japanese.",
    scriptRe:    JAPANESE_RE
  },
  korean: {
    label:       "Korean (한국어)",
    instruction: "Reply only in Korean using Hangul.",
    scriptRe:    KOREAN_RE
  },
  hinglish: {
    label:       "Hinglish in Roman script",
    instruction: "Reply only in Hinglish (Hindi-English mix) using Roman script. Do not use Devanagari. Write the way people casually type Hindi on WhatsApp — mix Hindi words naturally with English.",
    scriptRe:    null
  },
  english: {
    label:       "English",
    instruction: "Reply only in English. Do not switch to Hindi, Hinglish, Urdu, or Devanagari unless the user explicitly asks.",
    scriptRe:    null
  }
};

const HINGLISH_HINTS = new Set([
  "acha", "achha", "agar", "aap", "apko", "apna",
  "bata", "batao", "bataiye", "chahiye",
  "hai", "hain", "hoga", "hogi", "hua", "hui",
  "karo", "kar", "karna", "kaise", "kab", "kaha", "kahaan",
  "kya", "kyu", "kyun",
  "lekin", "mujhe", "nahi", "nahin", "pata",
  "samjhao", "samjha", "tha", "thi", "theek", "thik",
  "toh", "tum", "yaar", "yeh"
]);

function latinTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z']+/g) || [];
}

function countHinglishHints(value) {
  return latinTokens(value).filter((token) => HINGLISH_HINTS.has(token)).length;
}

export function detectExplicitLanguageRequest(value) {
  const text = String(value || "");
  if (!text.trim()) return "";

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+english\b/i.test(text) ||
    /\benglish\s+(me|mein)\b/i.test(text)
  ) return "english";

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+hinglish\b/i.test(text) ||
    /\bhinglish\s+(me|mein)\b/i.test(text)
  ) return "hinglish";

  if (
    /\b(reply|answer|respond|speak|write)\s+in\s+hindi\b/i.test(text) ||
    /\bhindi\s+(me|mein)\b/i.test(text) ||
    /हिंदी\s+में/u.test(text)
  ) return "hindi";

  return "";
}

export function detectLanguageStyle(value) {
  const explicit = detectExplicitLanguageRequest(value);
  if (explicit) return explicit;

  const text = String(value || "").trim();
  if (!text) return "english";

  // Non-Latin script detection — covers Hindi, Bengali, Telugu, Tamil,
  // Kannada, Malayalam, Gujarati, Punjabi, Arabic, Thai, Chinese, Japanese, Korean, Sinhala
  for (const { re, style } of SCRIPT_DETECTORS) {
    if (re.test(text)) return style;
  }

  // Roman script — check for Hinglish words
  const tokens = latinTokens(text);
  const hintCount = countHinglishHints(text);
  if (hintCount >= 2 || (hintCount >= 1 && tokens.length <= 8)) {
    return "hinglish";
  }

  return "english";
}

export function languageLabel(style) {
  return LANGUAGE_CONFIG[style]?.label ?? LANGUAGE_CONFIG.english.label;
}

export function languageInstruction(style) {
  return LANGUAGE_CONFIG[style]?.instruction ?? LANGUAGE_CONFIG.english.instruction;
}

export function isLanguageCompatible(text, style) {
  const value = String(text || "").trim();
  if (!value) return true;

  const cfg = LANGUAGE_CONFIG[style];
  if (!cfg) return true;

  // Non-Latin script languages: response must contain that script
  if (cfg.scriptRe) {
    return cfg.scriptRe.test(value);
  }

  // Hinglish: Devanagari in the response is wrong — reject it
  if (style === "hinglish") {
    return !DEVANAGARI_RE.test(value);
  }

  // English: reject Devanagari or heavy Hinglish mixing
  if (DEVANAGARI_RE.test(value)) return false;
  return countHinglishHints(value) < 2;
}
