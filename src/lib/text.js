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

function cleanInlineText(value) {
  return String(value || "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenInlineText(value, maxLen = 48) {
  const text = cleanInlineText(value);
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 3).trim()}...`;
}

function sourceSummaryLabel(source = {}) {
  return (
    cleanInlineText(source.domain).replace(/^www\./i, "") ||
    shortenInlineText(source.title, 40) ||
    shortenInlineText(source.uri, 48)
  );
}

function sourceDetailLabel(source = {}) {
  const title = shortenInlineText(source.title, 90);
  const domain = cleanInlineText(source.domain).replace(/^www\./i, "");
  if (title && domain && !title.toLowerCase().includes(domain.toLowerCase())) {
    return `${title} (${domain})`;
  }
  return title || domain || "Source";
}

function uniqueNumbers(values = []) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort(
    (left, right) => left - right
  );
}

function splitSentences(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const matches = text.match(/[^.!?।！？\n]+(?:[.!?।！？]+|$)/g);
  return (matches || [text])
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function defaultHeading(languageStyle = "english") {
  const headings = {
    hindi: "सारांश",
    hinglish: "Overview",
    bengali: "সারাংশ",
    gujarati: "સારાંશ",
    punjabi: "ਸਾਰ",
    tamil: "சுருக்கம்",
    telugu: "సారాంశం",
    kannada: "ಸಾರಾಂಶ",
    malayalam: "സംഗ്രഹം",
    arabic: "نظرة سريعة",
    urdu: "خلاصہ",
    persian: "خلاصه",
    thai: "ภาพรวม",
    chinese: "概述",
    japanese: "概要",
    korean: "개요",
    russian: "Кратко",
    greek: "Σύνοψη",
    hebrew: "סיכום",
    french: "Apercu",
    spanish: "Resumen",
    portuguese: "Resumo",
    german: "Uberblick",
    italian: "Sintesi",
    polish: "Podsumowanie",
    turkish: "Ozet",
    vietnamese: "Tong quan",
    indonesian: "Ringkasan",
    malay: "Ringkasan",
    filipino: "Buod",
    swahili: "Muhtasari"
  };

  return headings[String(languageStyle || "").toLowerCase()] || "Overview";
}

function deriveReplyHeading(body, languageStyle = "english") {
  const firstSentence = splitSentences(body)[0] || "";
  const raw = cleanInlineText(firstSentence.replace(/^[("'“”‘’\[]+/, ""));
  if (!raw) {
    return defaultHeading(languageStyle);
  }

  const matchers = [
    /^([^,.!?।！？:;\-]{2,40}?)\s+(?:is|are|was|were|means|refer(?:s)? to|also known as)\b/i,
    /^([^,.!?।！？:;\-]{2,40}?),(?:\s+also known as|\s+is|\s+are)\b/i,
    /^([^,.!?।！？:;\-]{2,40}?)\s*[:\-]\s+/i,
    /^([^,.!?।！？]{2,30}?),(?:\s|$)/
  ];

  for (const matcher of matchers) {
    const candidate = raw.match(matcher)?.[1];
    const cleanCandidate = cleanInlineText(candidate || "");
    if (!cleanCandidate) {
      continue;
    }

    const wordCount = cleanCandidate.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 1 && wordCount <= 5) {
      return cleanCandidate;
    }
  }

  return defaultHeading(languageStyle);
}

function splitTrailingSourceBlock(text) {
  const value = String(text || "").trim();
  if (!value) {
    return { body: "", sources: "" };
  }

  const headingMatch = value.match(/\n\n(\*Sources\*[\s\S]+)$/i);
  if (headingMatch) {
    return {
      body: value.slice(0, headingMatch.index).trim(),
      sources: headingMatch[1].trim()
    };
  }

  const numberedUrlBlock = value.match(/\n\n((?:\d+\.\s+https?:\/\/\S+(?:\n|$))+)\s*$/i);
  if (numberedUrlBlock) {
    return {
      body: value.slice(0, numberedUrlBlock.index).trim(),
      sources: numberedUrlBlock[1].trim()
    };
  }

  return { body: value, sources: "" };
}

function stripGenericFollowUp(text) {
  const sentences = splitSentences(text);
  if (sentences.length < 2) {
    return String(text || "").trim();
  }

  const genericFollowUpPatterns = [
    /would you like to know more/i,
    /would you like more details/i,
    /what would you like to know/i,
    /feel free to ask/i,
    /let me know if you(?:'d| would) like/i,
    /if you want,? i can/i,
    /is there anything else/i,
    /koi aur sawaal/i,
    /aap kya jaanna chahte/i,
    /agar aap.*jaanna chahte/i
  ];

  const lastSentence = sentences[sentences.length - 1];
  if (!genericFollowUpPatterns.some((pattern) => pattern.test(lastSentence))) {
    return String(text || "").trim();
  }

  return sentences.slice(0, -1).join(" ").trim();
}

function stripLeadingReplyHeading(text) {
  let value = String(text || "").trim();
  if (!value) {
    return "";
  }

  // Remove generic top labels like *Overview* or *Answer* that make replies feel robotic.
  value = value.replace(/^(?:\*[^*\n]{1,60}\*|_[^_\n]{1,60}_)\s*\n{1,2}/, "");
  value = value.replace(
    /^(?:overview|answer|explanation|summary|key points|key facts|highlights|response|quick answer|result)\s*:?\s*\n{1,2}/i,
    ""
  );

  return value.trim();
}

export function formatProfessionalReply(value, options = {}) {
  const cleaned = cleanUserFacingText(value);
  if (!cleaned) {
    return "";
  }

  const { body: rawBody, sources } = splitTrailingSourceBlock(cleaned);
  let body = stripLeadingReplyHeading(stripGenericFollowUp(rawBody));
  if (!body) {
    return cleaned;
  }

  const hasList = /(?:^|\n)(?:- |\d+\. )/.test(body);
  const sentences = splitSentences(body);

  if (!hasList && sentences.length >= 3) {
    const intro = sentences[0];
    const points = sentences
      .slice(1, 5)
      .map((sentence) => `- ${sentence}`);
    body = `${intro}\n\n${points.join("\n")}`;
  }

  body = stripLeadingReplyHeading(sanitizeForWhatsApp(body));
  if (!sources) {
    return body;
  }

  return `${body}\n\n${sources}`.trim();
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

export function formatSourceAttribution(sources, options = {}) {
  const items = Array.isArray(sources)
    ? sources
        .filter((source) => cleanInlineText(source?.uri))
        .slice(0, Math.max(1, options.maxSources || 6))
    : [];

  if (!items.length) {
    return "";
  }

  const summaryLabels = [];
  for (const source of items) {
    const label = sourceSummaryLabel(source);
    if (label && !summaryLabels.includes(label)) {
      summaryLabels.push(label);
    }
    if (summaryLabels.length >= 3) {
      break;
    }
  }

  if (!summaryLabels.length) {
    return "";
  }

  const includeHeading = options.includeHeading !== false;
  const sourcesHeading = cleanInlineText(options.sourcesHeading || "Sources") || "Sources";
  const urlOnly = options.urlOnly === true;
  const detailLines = items.map((source, index) => {
    if (urlOnly) {
      return `${index + 1}. ${cleanInlineText(source.uri)}`;
    }

    const label = sourceDetailLabel(source);
    return `${index + 1}. ${label}: ${cleanInlineText(source.uri)}`;
  });

  if (!includeHeading) {
    return detailLines.join("\n").trim();
  }

  return `*${sourcesHeading}*\n${detailLines.join("\n")}`.trim();
}

export function insertInlineSourceCitations(text, sources, supports, options = {}) {
  const baseText = String(text || "");
  if (!baseText.trim()) {
    return "";
  }

  const sourceMap = new Map();
  (Array.isArray(sources) ? sources : []).forEach((source, index) => {
    if (Number.isInteger(source?.index)) {
      sourceMap.set(source.index, index + 1);
    }
  });

  if (!sourceMap.size || !Array.isArray(supports) || !supports.length) {
    return baseText;
  }

  const markerFormatter =
    typeof options.formatMarker === "function"
      ? options.formatMarker
      : (numbers) => numbers.map((number) => `[${number}]`).join("");

  const markersByEndIndex = new Map();

  for (const support of supports) {
    const endIndex = Number(support?.segment?.endIndex);
    if (!Number.isFinite(endIndex) || endIndex <= 0 || endIndex > baseText.length) {
      continue;
    }

    const markerNumbers = uniqueNumbers(
      (support?.groundingChunkIndices || []).map((chunkIndex) => sourceMap.get(chunkIndex))
    );
    if (!markerNumbers.length) {
      continue;
    }

    const existing = markersByEndIndex.get(endIndex) || [];
    markersByEndIndex.set(endIndex, uniqueNumbers([...existing, ...markerNumbers]));
  }

  if (!markersByEndIndex.size) {
    return baseText;
  }

  const insertions = [...markersByEndIndex.entries()].sort((left, right) => right[0] - left[0]);
  let output = baseText;

  for (const [endIndex, numbers] of insertions) {
    const marker = ` ${markerFormatter(numbers, sourceMap)}`;
    output = `${output.slice(0, endIndex)}${marker}${output.slice(endIndex)}`;
  }

  return output;
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
