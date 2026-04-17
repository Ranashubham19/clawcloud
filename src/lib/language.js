// ── Script Unicode regexes ──────────────────────────────────────────────────
const DEVANAGARI_RE  = /\p{Script=Devanagari}/u;
const BENGALI_RE     = /\p{Script=Bengali}/u;
const GUJARATI_RE    = /\p{Script=Gujarati}/u;
const GURMUKHI_RE    = /\p{Script=Gurmukhi}/u;
const KANNADA_RE     = /\p{Script=Kannada}/u;
const MALAYALAM_RE   = /\p{Script=Malayalam}/u;
const TAMIL_RE       = /\p{Script=Tamil}/u;
const TELUGU_RE      = /\p{Script=Telugu}/u;
const ARABIC_RE      = /\p{Script=Arabic}/u;
const THAI_RE        = /\p{Script=Thai}/u;
const SINHALA_RE     = /\p{Script=Sinhala}/u;
const CHINESE_RE     = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const JAPANESE_RE    = /[\u3040-\u30ff\u31f0-\u31ff]/;
const KOREAN_RE      = /[\uac00-\ud7af]/;
const CYRILLIC_RE    = /\p{Script=Cyrillic}/u;
const GREEK_RE       = /\p{Script=Greek}/u;
const HEBREW_RE      = /\p{Script=Hebrew}/u;
const GEORGIAN_RE    = /\p{Script=Georgian}/u;
const ARMENIAN_RE    = /\p{Script=Armenian}/u;
const ETHIOPIC_RE    = /\p{Script=Ethiopic}/u;
const KHMER_RE       = /\p{Script=Khmer}/u;
const MYANMAR_RE     = /\p{Script=Myanmar}/u;
const LAO_RE         = /\p{Script=Lao}/u;
const TIBETAN_RE     = /\p{Script=Tibetan}/u;

// Vietnamese has very distinctive stacked diacritics: ắặẹổồọị ừứửữảẫếềệờỡổ…
const VIETNAMESE_RE  = /[ắặẹổồọịựừứửữảẫếềệờỡộũơưăđ]/iu;

// French: ç or œ are near-certain; also catches accented vowels unique to French
const FRENCH_DIAC_RE    = /[çœæÇŒÆ]/u;
// German: ä ö ü ß
const GERMAN_DIAC_RE    = /[äöüÄÖÜß]/u;
// Spanish: ñ ¿ ¡
const SPANISH_DIAC_RE   = /[ñÑ¿¡]/u;
// Portuguese: ã õ — distinct from Spanish
const PORTUGUESE_DIAC_RE = /[ãõÃÕ]/u;
// Turkish: ş ğ ı İ — very distinctive
const TURKISH_DIAC_RE   = /[şğıŞĞİ]/u;
// Polish: ą ę ś ź ż ć ń ł
const POLISH_DIAC_RE    = /[ąęśźżćńłĄĘŚŹŻĆŃŁ]/u;

// ── Script detection table (ordered — checked top-to-bottom) ────────────────
const SCRIPT_DETECTORS = [
  { re: DEVANAGARI_RE,  style: "hindi"      },
  { re: BENGALI_RE,     style: "bengali"    },
  { re: GUJARATI_RE,    style: "gujarati"   },
  { re: GURMUKHI_RE,    style: "punjabi"    },
  { re: KANNADA_RE,     style: "kannada"    },
  { re: MALAYALAM_RE,   style: "malayalam"  },
  { re: TAMIL_RE,       style: "tamil"      },
  { re: TELUGU_RE,      style: "telugu"     },
  { re: ARABIC_RE,      style: "arabic"     },
  { re: THAI_RE,        style: "thai"       },
  { re: SINHALA_RE,     style: "sinhala"    },
  { re: CHINESE_RE,     style: "chinese"    },
  { re: JAPANESE_RE,    style: "japanese"   },
  { re: KOREAN_RE,      style: "korean"     },
  { re: CYRILLIC_RE,    style: "russian"    },
  { re: GREEK_RE,       style: "greek"      },
  { re: HEBREW_RE,      style: "hebrew"     },
  { re: GEORGIAN_RE,    style: "georgian"   },
  { re: ARMENIAN_RE,    style: "armenian"   },
  { re: ETHIOPIC_RE,    style: "amharic"    },
  { re: KHMER_RE,       style: "khmer"      },
  { re: MYANMAR_RE,     style: "burmese"    },
  { re: LAO_RE,         style: "lao"        },
  { re: TIBETAN_RE,     style: "tibetan"    }
];

// ── Hint words for Roman-script languages ───────────────────────────────────
const FRENCH_HINTS = new Set([
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "est", "sont", "avoir", "être", "faire", "aller",
  "le", "la", "les", "des", "du", "une", "mon", "ma", "mes",
  "bonjour", "bonsoir", "salut", "merci", "oui", "non",
  "et", "ou", "mais", "donc", "car", "ni", "or",
  "que", "qui", "quoi", "comment", "pourquoi", "quand",
  "avec", "pour", "dans", "sur", "par", "pas", "plus", "très",
  "bien", "tout", "voila", "voilà", "aussi", "encore", "même"
]);

const SPANISH_HINTS = new Set([
  "yo", "tú", "él", "ella", "nosotros", "vosotros", "ellos", "ellas",
  "es", "son", "estar", "ser", "haber", "tener", "hacer",
  "el", "la", "los", "las", "una", "unos",
  "hola", "gracias", "sí", "si", "no", "también", "también",
  "pero", "que", "qué", "cómo", "como", "cuándo", "cuando",
  "dónde", "donde", "por", "para", "con", "sin", "sobre",
  "muy", "más", "menos", "todo", "nada", "algo", "alguien",
  "adios", "adiós", "buenas", "buenos"
]);

const PORTUGUESE_HINTS = new Set([
  "eu", "tu", "ele", "ela", "nós", "vós", "eles", "elas",
  "é", "são", "estar", "ser", "ter", "fazer",
  "o", "a", "os", "as", "uma", "uns", "umas",
  "olá", "obrigado", "obrigada", "sim", "não", "também",
  "mas", "que", "como", "quando", "onde", "por", "para",
  "com", "sem", "sobre", "muito", "mais", "menos",
  "tudo", "nada", "algo", "alguém", "aqui", "isso", "isto",
  "boa", "bom", "oi", "tchau"
]);

const GERMAN_HINTS = new Set([
  "ich", "du", "er", "sie", "wir", "ihr",
  "ist", "sind", "haben", "sein", "werden", "können", "müssen",
  "der", "die", "das", "ein", "eine", "einen", "einem",
  "hallo", "guten", "danke", "bitte", "ja", "nein",
  "und", "oder", "aber", "denn", "weil", "obwohl",
  "nicht", "kein", "keine", "auch", "noch", "schon",
  "wie", "was", "wer", "wo", "wann", "warum",
  "mit", "auf", "an", "in", "bei", "von", "zu", "für", "über",
  "gut", "schlecht", "sehr", "mehr", "alle", "alles"
]);

const ITALIAN_HINTS = new Set([
  "io", "tu", "lui", "lei", "noi", "voi", "loro",
  "è", "sono", "essere", "avere", "fare", "andare",
  "il", "lo", "la", "i", "gli", "le", "uno", "una",
  "ciao", "buongiorno", "buonasera", "grazie", "prego", "sì", "no",
  "e", "o", "ma", "però", "perché", "come", "quando", "dove",
  "con", "senza", "su", "per", "da", "di", "in", "a",
  "molto", "anche", "già", "ancora", "sempre", "mai", "tutto"
]);

const DUTCH_HINTS = new Set([
  "ik", "jij", "hij", "zij", "wij", "jullie",
  "is", "zijn", "hebben", "worden", "kunnen", "moeten",
  "de", "het", "een", "mijn", "jouw", "zijn",
  "hallo", "hoi", "goedendag", "dank", "ja", "nee",
  "en", "of", "maar", "omdat", "dus", "want",
  "niet", "geen", "ook", "nog", "al",
  "hoe", "wat", "wie", "waar", "wanneer", "waarom",
  "met", "op", "aan", "in", "bij", "van", "te", "voor"
]);

const TURKISH_HINTS = new Set([
  "ben", "sen", "o", "biz", "siz", "onlar",
  "bir", "bu", "şu", "ve", "de", "da", "ile", "ama", "fakat",
  "merhaba", "selam", "teşekkür", "evet", "hayır",
  "nasıl", "nerede", "ne", "kim", "neden", "ne zaman",
  "için", "ile", "kadar", "gibi", "çok", "daha", "en",
  "var", "yok", "değil", "istiyor", "geliyor"
]);

const INDONESIAN_HINTS = new Set([
  "saya", "kamu", "anda", "dia", "kita", "kami", "mereka",
  "adalah", "ada", "tidak", "iya", "ya", "tidak",
  "yang", "dan", "dengan", "untuk", "dari", "di", "ke",
  "ini", "itu", "juga", "sudah", "akan", "bisa", "mau",
  "halo", "selamat", "terima", "kasih", "pagi", "siang", "malam",
  "apa", "siapa", "mana", "kapan", "bagaimana", "kenapa", "mengapa",
  "sangat", "sekali", "lebih", "semua", "banyak"
]);

const MALAY_HINTS = new Set([
  "saya", "awak", "anda", "dia", "kita", "kami", "mereka",
  "ialah", "ada", "tidak", "ya", "tidak",
  "yang", "dan", "dengan", "untuk", "dari", "di", "ke",
  "ini", "itu", "juga", "sudah", "akan", "boleh",
  "helo", "selamat", "terima", "kasih", "pagi", "tengahari", "malam",
  "apa", "siapa", "mana", "bila", "bagaimana", "kenapa",
  "sangat", "lebih", "semua", "banyak"
]);

const FILIPINO_HINTS = new Set([
  "ako", "ikaw", "siya", "kami", "tayo", "sila", "kayo",
  "ang", "ng", "mga", "sa", "at", "ay", "si", "ni",
  "ko", "mo", "ka", "niya", "namin", "natin", "nila",
  "hindi", "oo", "opo", "kamusta", "salamat", "mabuti",
  "din", "rin", "lang", "nga", "naman", "ba", "po",
  "ano", "sino", "saan", "kailan", "paano", "bakit",
  "mahal", "masaya", "maganda", "mabuti", "maraming", "sobra"
]);

const SWAHILI_HINTS = new Set([
  "mimi", "wewe", "yeye", "sisi", "nyinyi", "wao",
  "ni", "si", "na", "ya", "wa", "la", "za", "kwa", "au",
  "hii", "hiyo", "huyu", "hao", "hapa", "pale",
  "habari", "asante", "tafadhali", "ndiyo", "hapana", "karibu",
  "kwa", "heri", "pole", "rafiki", "bado", "sasa", "kesho",
  "nini", "nani", "wapi", "lini", "vipi", "kwa", "nini"
]);

// ── LANGUAGE_CONFIG ──────────────────────────────────────────────────────────
const LANGUAGE_CONFIG = {
  hindi: {
    label: "Hindi in Devanagari script",
    instruction: "Reply only in Hindi using Devanagari script. Do not use Roman script or English.",
    scriptRe: DEVANAGARI_RE
  },
  bengali: {
    label: "Bengali (বাংলা)",
    instruction: "Reply only in Bengali using Bengali script.",
    scriptRe: BENGALI_RE
  },
  gujarati: {
    label: "Gujarati (ગુજરાતી)",
    instruction: "Reply only in Gujarati using Gujarati script.",
    scriptRe: GUJARATI_RE
  },
  punjabi: {
    label: "Punjabi in Gurmukhi script (ਪੰਜਾਬੀ)",
    instruction: "Reply only in Punjabi using Gurmukhi script.",
    scriptRe: GURMUKHI_RE
  },
  kannada: {
    label: "Kannada (ಕನ್ನಡ)",
    instruction: "Reply only in Kannada using Kannada script.",
    scriptRe: KANNADA_RE
  },
  malayalam: {
    label: "Malayalam (മലയാളം)",
    instruction: "Reply only in Malayalam using Malayalam script.",
    scriptRe: MALAYALAM_RE
  },
  tamil: {
    label: "Tamil (தமிழ்)",
    instruction: "Reply only in Tamil using Tamil script.",
    scriptRe: TAMIL_RE
  },
  telugu: {
    label: "Telugu (తెలుగు)",
    instruction: "Reply only in Telugu using Telugu script.",
    scriptRe: TELUGU_RE
  },
  arabic: {
    label: "Arabic (عربي)",
    instruction: "Reply only in Arabic using Arabic script.",
    scriptRe: ARABIC_RE
  },
  urdu: {
    label: "Urdu (اردو)",
    instruction: "Reply only in Urdu using Nastaliq/Arabic script. Write proper Urdu, not transliteration.",
    scriptRe: ARABIC_RE
  },
  persian: {
    label: "Persian / Farsi (فارسی)",
    instruction: "Reply only in Persian (Farsi) using Arabic script.",
    scriptRe: ARABIC_RE
  },
  thai: {
    label: "Thai (ภาษาไทย)",
    instruction: "Reply only in Thai using Thai script.",
    scriptRe: THAI_RE
  },
  sinhala: {
    label: "Sinhala (සිංහල)",
    instruction: "Reply only in Sinhala using Sinhala script.",
    scriptRe: SINHALA_RE
  },
  chinese: {
    label: "Chinese (中文)",
    instruction: "Reply only in Chinese. Match Simplified or Traditional based on the user's input.",
    scriptRe: CHINESE_RE
  },
  japanese: {
    label: "Japanese (日本語)",
    instruction: "Reply only in Japanese.",
    scriptRe: JAPANESE_RE
  },
  korean: {
    label: "Korean (한국어)",
    instruction: "Reply only in Korean using Hangul.",
    scriptRe: KOREAN_RE
  },
  russian: {
    label: "Russian (Русский)",
    instruction: "Reply only in Russian using Cyrillic script. If the user appears to write Ukrainian or Bulgarian, match their language exactly.",
    scriptRe: CYRILLIC_RE
  },
  greek: {
    label: "Greek (Ελληνικά)",
    instruction: "Reply only in Greek using Greek script.",
    scriptRe: GREEK_RE
  },
  hebrew: {
    label: "Hebrew (עברית)",
    instruction: "Reply only in Hebrew using Hebrew script.",
    scriptRe: HEBREW_RE
  },
  georgian: {
    label: "Georgian (ქართული)",
    instruction: "Reply only in Georgian using Georgian script.",
    scriptRe: GEORGIAN_RE
  },
  armenian: {
    label: "Armenian (Հայերեն)",
    instruction: "Reply only in Armenian using Armenian script.",
    scriptRe: ARMENIAN_RE
  },
  amharic: {
    label: "Amharic (አማርኛ)",
    instruction: "Reply only in Amharic using Ethiopic (Ge'ez) script.",
    scriptRe: ETHIOPIC_RE
  },
  khmer: {
    label: "Khmer / Cambodian (ខ្មែរ)",
    instruction: "Reply only in Khmer using Khmer script.",
    scriptRe: KHMER_RE
  },
  burmese: {
    label: "Burmese / Myanmar (မြန်မာဘာသာ)",
    instruction: "Reply only in Burmese using Myanmar script.",
    scriptRe: MYANMAR_RE
  },
  lao: {
    label: "Lao (ພາສາລາວ)",
    instruction: "Reply only in Lao using Lao script.",
    scriptRe: LAO_RE
  },
  tibetan: {
    label: "Tibetan (བོད་སྐད།)",
    instruction: "Reply only in Tibetan using Tibetan script.",
    scriptRe: TIBETAN_RE
  },
  french: {
    label: "French (Français)",
    instruction: "Reply only in French. Use correct grammar, accents, and punctuation.",
    scriptRe: null
  },
  spanish: {
    label: "Spanish (Español)",
    instruction: "Reply only in Spanish. Use correct grammar and accents.",
    scriptRe: null
  },
  portuguese: {
    label: "Portuguese (Português)",
    instruction: "Reply only in Portuguese. Match Brazilian or European based on the user's writing style.",
    scriptRe: null
  },
  german: {
    label: "German (Deutsch)",
    instruction: "Reply only in German. Use correct grammar, umlauts, and punctuation.",
    scriptRe: null
  },
  italian: {
    label: "Italian (Italiano)",
    instruction: "Reply only in Italian. Use correct grammar and accents.",
    scriptRe: null
  },
  dutch: {
    label: "Dutch (Nederlands)",
    instruction: "Reply only in Dutch. Use correct grammar.",
    scriptRe: null
  },
  turkish: {
    label: "Turkish (Türkçe)",
    instruction: "Reply only in Turkish. Use correct grammar and special characters (ş, ğ, ı, ç, ö, ü).",
    scriptRe: null
  },
  vietnamese: {
    label: "Vietnamese (Tiếng Việt)",
    instruction: "Reply only in Vietnamese. Use correct diacritics and tones.",
    scriptRe: null
  },
  indonesian: {
    label: "Indonesian (Bahasa Indonesia)",
    instruction: "Reply only in Indonesian (Bahasa Indonesia). Use correct grammar.",
    scriptRe: null
  },
  malay: {
    label: "Malay (Bahasa Melayu)",
    instruction: "Reply only in Malay (Bahasa Melayu). Use correct grammar.",
    scriptRe: null
  },
  filipino: {
    label: "Filipino / Tagalog",
    instruction: "Reply only in Filipino (Tagalog). Use correct grammar.",
    scriptRe: null
  },
  swahili: {
    label: "Swahili (Kiswahili)",
    instruction: "Reply only in Swahili. Use correct grammar.",
    scriptRe: null
  },
  polish: {
    label: "Polish (Polski)",
    instruction: "Reply only in Polish. Use correct grammar and special characters (ą, ę, ś, ź, ż, ć, ń, ł).",
    scriptRe: null
  },
  hinglish: {
    label: "Hinglish in Roman script",
    instruction: "Reply only in Hinglish (Hindi-English mix) using Roman script. Do not use Devanagari. Write the way people casually type Hindi on WhatsApp — mix Hindi words naturally with English.",
    scriptRe: null
  },
  english: {
    label: "English",
    instruction: "Reply only in English. Do not switch to Hindi, Hinglish, Urdu, or Devanagari unless the user explicitly asks.",
    scriptRe: null
  }
};

// ── Hinglish hints ────────────────────────────────────────────────────────────
const HINGLISH_HINTS = new Set([
  "acha", "achha", "agar", "aap", "apko", "apna",
  "bata", "batao", "bataiye", "chahiye",
  "hai", "hain", "hoga", "hogi", "hua", "hui",
  "karo", "kar", "karna", "kaise", "kab", "kaha", "kahaan",
  "kya", "kyu", "kyun",
  "lekin", "mujhe", "nahi", "nahin", "pata",
  "samjhao", "samjha", "tha", "thi", "theek", "thik",
  "toh", "tum", "yaar", "yeh", "bhai", "yaar", "mera",
  "tera", "uska", "aur", "bas", "abhi", "aaj", "kal"
]);

function latinTokens(value) {
  return String(value || "").toLowerCase().match(/[a-zàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿşğıłąęśźżćń']+/g) || [];
}

function countHints(value, hintSet) {
  return latinTokens(value).filter((t) => hintSet.has(t)).length;
}

function hasDiacritic(value, re) {
  return re.test(value);
}

// ── Roman-script language detectors (ordered by specificity) ──────────────────
function detectRomanScript(text) {
  const tokens = latinTokens(text);
  const len = tokens.length;

  // Vietnamese — diacritics are extremely distinctive
  if (VIETNAMESE_RE.test(text)) return "vietnamese";

  // Turkish — distinctive chars: ş ğ ı İ
  if (hasDiacritic(text, TURKISH_DIAC_RE)) return "turkish";
  if (countHints(text, TURKISH_HINTS) >= 2) return "turkish";

  // Polish — distinctive chars: ą ę ś ź ż ć ń ł
  if (hasDiacritic(text, POLISH_DIAC_RE)) return "polish";

  // German — ä ö ü ß
  if (hasDiacritic(text, GERMAN_DIAC_RE)) return "german";

  // Portuguese — ã õ (before Spanish so ã/õ wins)
  if (hasDiacritic(text, PORTUGUESE_DIAC_RE)) return "portuguese";
  if (countHints(text, PORTUGUESE_HINTS) >= 2) return "portuguese";

  // Spanish — ñ ¿ ¡
  if (hasDiacritic(text, SPANISH_DIAC_RE)) return "spanish";
  if (countHints(text, SPANISH_HINTS) >= 2) return "spanish";

  // French — ç œ
  if (hasDiacritic(text, FRENCH_DIAC_RE)) return "french";
  if (countHints(text, FRENCH_HINTS) >= 2) return "french";

  // German word-based (no umlauts typed)
  if (countHints(text, GERMAN_HINTS) >= 2) return "german";

  // Italian
  if (countHints(text, ITALIAN_HINTS) >= 2) return "italian";

  // Dutch
  if (countHints(text, DUTCH_HINTS) >= 2) return "dutch";

  // Filipino/Tagalog — very distinctive particles
  if (countHints(text, FILIPINO_HINTS) >= 2) return "filipino";

  // Indonesian / Malay
  const idScore = countHints(text, INDONESIAN_HINTS);
  const myScore = countHints(text, MALAY_HINTS);
  if (idScore >= 2 || myScore >= 2) return idScore >= myScore ? "indonesian" : "malay";

  // Swahili
  if (countHints(text, SWAHILI_HINTS) >= 2) return "swahili";

  // Hinglish
  const hintCount = countHints(text, HINGLISH_HINTS);
  if (hintCount >= 2 || (hintCount >= 1 && len <= 8)) return "hinglish";

  return "english";
}

// ── LANG_KEYWORD_MAP for explicit switch requests ─────────────────────────────
const LANG_KEYWORD_MAP = [
  { re: /\b(hindi|हिंदी)\b/iu,              style: "hindi"      },
  { re: /\bhinglish\b/i,                    style: "hinglish"   },
  { re: /\b(bengali|bangla|বাংলা)\b/i,      style: "bengali"    },
  { re: /\bgujarati\b/i,                    style: "gujarati"   },
  { re: /\b(punjabi|panjabi)\b/i,           style: "punjabi"    },
  { re: /\bkannada\b/i,                     style: "kannada"    },
  { re: /\bmalayalam\b/i,                   style: "malayalam"  },
  { re: /\btamil\b/i,                       style: "tamil"      },
  { re: /\btelugu\b/i,                      style: "telugu"     },
  { re: /\burdu\b/i,                        style: "urdu"       },
  { re: /\b(arabic|arabi)\b/i,              style: "arabic"     },
  { re: /\b(persian|farsi|فارسی)\b/i,       style: "persian"    },
  { re: /\bthai\b/i,                        style: "thai"       },
  { re: /\b(chinese|mandarin|cantonese)\b/i,style: "chinese"    },
  { re: /\bjapanese\b/i,                    style: "japanese"   },
  { re: /\bkorean\b/i,                      style: "korean"     },
  { re: /\b(russian|русский)\b/i,           style: "russian"    },
  { re: /\b(ukrainian|украинский)\b/i,      style: "russian"    },
  { re: /\bgreek\b/i,                       style: "greek"      },
  { re: /\bhebrew\b/i,                      style: "hebrew"     },
  { re: /\bgeorgian\b/i,                    style: "georgian"   },
  { re: /\barmenian\b/i,                    style: "armenian"   },
  { re: /\bamharic\b/i,                     style: "amharic"    },
  { re: /\bkhmer\b/i,                       style: "khmer"      },
  { re: /\b(burmese|myanmar)\b/i,           style: "burmese"    },
  { re: /\blao\b/i,                         style: "lao"        },
  { re: /\bfrench|français|francais\b/i,    style: "french"     },
  { re: /\b(spanish|español|espanol)\b/i,   style: "spanish"    },
  { re: /\b(portuguese|português|portugues)\b/i, style: "portuguese" },
  { re: /\b(german|deutsch)\b/i,            style: "german"     },
  { re: /\b(italian|italiano)\b/i,          style: "italian"    },
  { re: /\b(dutch|nederlands)\b/i,          style: "dutch"      },
  { re: /\b(turkish|türkçe|turkce)\b/i,     style: "turkish"    },
  { re: /\b(vietnamese|tiếng việt)\b/i,     style: "vietnamese" },
  { re: /\b(indonesian|bahasa indonesia)\b/i, style: "indonesian" },
  { re: /\b(malay|bahasa melayu)\b/i,       style: "malay"      },
  { re: /\b(filipino|tagalog)\b/i,          style: "filipino"   },
  { re: /\b(swahili|kiswahili)\b/i,         style: "swahili"    },
  { re: /\b(polish|polski)\b/i,             style: "polish"     },
  { re: /\benglish\b/i,                     style: "english"    }
];

// Phrases that signal an explicit language switch request
const LANG_SWITCH_RE =
  /\b(in|mein|mai|main|me|ko|give\s+in|tell\s+in|say\s+in|write\s+in|reply\s+in|answer\s+in|respond\s+in|speak\s+in|translate\s+to|explain\s+in|bolo|batao|likho|into|switch\s+to|use)\b/i;

export function detectExplicitLanguageRequest(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (!LANG_SWITCH_RE.test(text)) return "";

  for (const { re, style } of LANG_KEYWORD_MAP) {
    if (re.test(text)) return style;
  }

  return "";
}

export function detectLanguageStyle(value) {
  const explicit = detectExplicitLanguageRequest(value);
  if (explicit) return explicit;

  const text = String(value || "").trim();
  if (!text) return "english";

  // Non-Latin script detection
  for (const { re, style } of SCRIPT_DETECTORS) {
    if (re.test(text)) return style;
  }

  // Roman-script language detection
  return detectRomanScript(text);
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

  // Script-based languages: response must contain that script
  if (cfg.scriptRe) {
    return cfg.scriptRe.test(value);
  }

  // Hinglish: Devanagari in response is wrong
  if (style === "hinglish") {
    return !DEVANAGARI_RE.test(value);
  }

  // For Roman-script non-English languages: skip strict check,
  // trust the model — checking would require NLP-level analysis
  if (style !== "english") return true;

  // English: reject Devanagari or heavy Hinglish mixing
  if (DEVANAGARI_RE.test(value)) return false;
  return countHints(value, HINGLISH_HINTS) < 2;
}
