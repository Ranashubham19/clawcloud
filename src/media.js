import zlib from "node:zlib";

const DEFAULT_TEXT_LIMIT = 24000;

const MIME_ALIASES = {
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-aiff": "audio/aiff",
  "audio/x-aac": "audio/aac",
  "audio/x-flac": "audio/flac",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/opus": "audio/ogg",
  "image/jpg": "image/jpeg",
  "video/mov": "video/quicktime",
  "video/avi": "video/x-msvideo",
  "text/x-markdown": "text/markdown",
  "text/javascript": "application/javascript",
  "application/x-javascript": "application/javascript",
  "application/x-zip-compressed": "application/zip",
  "video/quicktime": "video/quicktime",
  "video/x-msvideo": "video/x-msvideo",
  "video/3gp": "video/3gpp"
};

const EXTENSION_MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  wave: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  amr: "audio/amr",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  pdf: "application/pdf",
  txt: "text/plain",
  text: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/jsonl",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/jsx",
  py: "text/x-python",
  java: "text/x-java-source",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  go: "text/x-go",
  rs: "text/x-rust",
  rb: "text/x-ruby",
  php: "text/x-php",
  sql: "application/sql",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  rtf: "application/rtf",
  vcf: "text/vcard",
  vcard: "text/vcard",
  ics: "text/calendar",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip"
};

const DEFAULT_MIME_BY_MEDIA_TYPE = {
  image: "image/jpeg",
  photo: "image/jpeg",
  sticker: "image/webp",
  animation: "image/gif",
  audio: "audio/mpeg",
  voice: "audio/ogg",
  video: "video/mp4",
  video_note: "video/mp4",
  document: "application/octet-stream"
};

const GEMINI_SUPPORTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/mp4",
  "audio/ogg",
  "audio/flac",
  "audio/opus",
  "audio/amr",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-flv",
  "video/webm",
  "video/wmv",
  "video/3gpp",
  "application/pdf",
  "text/plain",
  "text/html",
  "text/css",
  "text/csv",
  "text/markdown",
  "text/xml",
  "application/xml",
  "application/xhtml+xml",
  "application/json",
  "application/javascript",
  "text/javascript",
  "application/rtf",
  "text/rtf"
]);

const HUMAN_FORMAT_NAMES = {
  "application/msword": "Word document (.doc)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document (.docx)",
  "application/vnd.ms-excel": "Excel spreadsheet (.xls)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel spreadsheet (.xlsx)",
  "application/vnd.ms-powerpoint": "PowerPoint presentation (.ppt)",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint presentation (.pptx)",
  "application/vnd.oasis.opendocument.text": "OpenDocument text file (.odt)",
  "application/vnd.oasis.opendocument.spreadsheet": "OpenDocument spreadsheet (.ods)",
  "application/vnd.oasis.opendocument.presentation": "OpenDocument presentation (.odp)",
  "application/pdf": "PDF",
  "application/zip": "ZIP archive",
  "application/vnd.rar": "RAR archive",
  "application/x-7z-compressed": "7z archive",
  "application/x-tar": "TAR archive",
  "application/gzip": "GZIP archive",
  "application/octet-stream": "binary file"
};

const XML_TEXT_TAGS = [
  /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi,
  /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi,
  /<t\b[^>]*>([\s\S]*?)<\/t>/gi,
  /<v\b[^>]*>([\s\S]*?)<\/v>/gi,
  /<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi,
  /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/gi,
  /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi
];

function cleanText(value) {
  return String(value || "").trim();
}

function extensionFromFilename(filename = "") {
  const match = cleanText(filename).toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? match[1] : "";
}

function mimeFromFilename(filename = "") {
  return EXTENSION_MIME_TYPES[extensionFromFilename(filename)] || "";
}

export function normalizeMimeType(raw) {
  if (!raw) return "application/octet-stream";
  const base = String(raw).split(";")[0].trim().toLowerCase();
  if (!base) return "application/octet-stream";
  return MIME_ALIASES[base] || base;
}

export function inferMimeType({ mimeType = "", filename = "", mediaType = "" } = {}) {
  const rawMime = cleanText(mimeType);
  const normalized = rawMime ? normalizeMimeType(rawMime) : "";
  const fromName = mimeFromFilename(filename);

  if (
    fromName &&
    (!rawMime ||
      normalized === "application/octet-stream" ||
      normalized === "binary/octet-stream")
  ) {
    return normalizeMimeType(fromName);
  }

  if (
    normalized &&
    normalized !== "application/octet-stream" &&
    normalized !== "binary/octet-stream"
  ) {
    return normalized;
  }

  return DEFAULT_MIME_BY_MEDIA_TYPE[String(mediaType || "").toLowerCase()] || "application/octet-stream";
}

export function isGeminiInlineSupportedMime(mimeType) {
  return GEMINI_SUPPORTED_MIME.has(normalizeMimeType(mimeType));
}

export function unsupportedFormatName(mimeType, filename = "") {
  const normalized = normalizeMimeType(mimeType);
  if (HUMAN_FORMAT_NAMES[normalized]) {
    return HUMAN_FORMAT_NAMES[normalized];
  }

  const ext = extensionFromFilename(filename);
  if (ext) {
    return `${ext.toUpperCase()} file`;
  }

  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio file";
  if (normalized.startsWith("video/")) return "video file";
  if (normalized.startsWith("text/")) return "text file";
  return normalized || "file";
}

export function describeMediaAttachment({ mediaType = "", mimeType = "", filename = "" } = {}) {
  const normalized = inferMimeType({ mimeType, filename, mediaType });
  const name = cleanText(filename);
  const lowerMedia = String(mediaType || "").toLowerCase();

  if (lowerMedia === "voice") return "voice recording";
  if (lowerMedia === "video_note") return "video note";
  if (lowerMedia === "photo" || lowerMedia === "image" || normalized.startsWith("image/")) {
    return name ? `image (${name})` : "image";
  }
  if (lowerMedia === "sticker") return "sticker";
  if (lowerMedia === "animation") return name ? `animation (${name})` : "animation";
  if (normalized.startsWith("audio/")) return name ? `audio file (${name})` : "audio file";
  if (normalized.startsWith("video/")) return name ? `video file (${name})` : "video file";
  if (normalized === "application/pdf") return name ? `PDF (${name})` : "PDF";
  return name ? `${unsupportedFormatName(normalized, name)} (${name})` : unsupportedFormatName(normalized);
}

function isTextLikeMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/jsonl",
      "application/xml",
      "application/xhtml+xml",
      "application/javascript",
      "application/sql",
      "application/x-yaml",
      "application/rtf",
      "text/rtf",
      "image/svg+xml",
      "text/vcard",
      "text/calendar"
    ].includes(mime)
  );
}

function isZipContainerMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  return [
    "application/zip",
    "application/epub+zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation"
  ].includes(mime);
}

function isLegacyOfficeMime(mimeType) {
  return [
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint"
  ].includes(normalizeMimeType(mimeType));
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    });
}

function normalizeExtractedText(value, maxChars = DEFAULT_TEXT_LIMIT) {
  const text = String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, maxChars).trimEnd(),
    truncated: true
  };
}

function looksLikeBinaryText(value) {
  if (!value) return false;
  const sample = value.slice(0, Math.min(value.length, 4000));
  const bad = sample.match(/[\u0000-\u0008\u000E-\u001F]/g) || [];
  return bad.length / Math.max(1, sample.length) > 0.04;
}

function decodeTextBuffer(buffer, mimeType) {
  const raw = buffer.toString("utf8");
  if (looksLikeBinaryText(raw)) {
    return "";
  }

  const mime = normalizeMimeType(mimeType);
  if (mime === "application/json" || mime === "application/jsonl") {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  if (mime === "application/rtf" || mime === "text/rtf") {
    return stripRtf(raw);
  }

  if (mime === "text/html" || mime === "application/xhtml+xml" || mime === "image/svg+xml") {
    return htmlToText(raw);
  }

  if (mime === "application/xml" || mime === "text/xml") {
    return xmlToText(raw);
  }

  return raw;
}

function stripRtf(value) {
  return String(value || "")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\\[a-z]+\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function htmlToText(value) {
  return decodeXmlEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function xmlToText(value) {
  const source = String(value || "");
  const extracted = [];

  for (const pattern of XML_TEXT_TAGS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      extracted.push(decodeXmlEntities(match[1]));
      match = pattern.exec(source);
    }
  }

  if (extracted.length) {
    return extracted.join("\n");
  }

  return decodeXmlEntities(source.replace(/<[^>]+>/g, " "));
}

function parseZipEntries(buffer) {
  const entries = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    return entries;
  }

  const minOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    return entries;
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirOffset;

  for (let index = 0; index < totalEntries && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .slice(offset + 46, offset + 46 + nameLength)
      .toString("utf8")
      .replace(/\\/g, "/");

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entry, maxUncompressedBytes = 2 * 1024 * 1024) {
  if (!entry || entry.name.endsWith("/") || entry.uncompressedSize > maxUncompressedBytes) {
    return null;
  }

  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    return null;
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length) {
    return null;
  }

  const compressed = buffer.slice(dataStart, dataEnd);
  try {
    if (entry.method === 0) {
      return compressed;
    }
    if (entry.method === 8) {
      return zlib.inflateRawSync(compressed, {
        finishFlush: zlib.constants.Z_SYNC_FLUSH
      });
    }
  } catch {
    return null;
  }

  return null;
}

function zipEntryPriority(name, mimeType) {
  const lower = name.toLowerCase();
  const mime = normalizeMimeType(mimeType);

  if (mime.includes("wordprocessingml") && /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(lower)) {
    return 1;
  }
  if (mime.includes("spreadsheetml") && /^xl\/(sharedstrings|worksheets\/sheet\d+)\.xml$/.test(lower)) {
    return 1;
  }
  if (mime.includes("presentationml") && /^ppt\/slides\/slide\d+\.xml$/.test(lower)) {
    return 1;
  }
  if (mime.includes("opendocument") && lower === "content.xml") {
    return 1;
  }
  if (mime === "application/epub+zip" && /\.(xhtml|html|xml)$/i.test(lower)) {
    return 2;
  }
  if (/\.(txt|md|csv|json|xml|html|htm|rtf|svg|yml|yaml|js|ts|css|sql)$/i.test(lower)) {
    return 3;
  }
  return 0;
}

function extractZipText(buffer, mimeType, maxChars) {
  const entries = parseZipEntries(buffer)
    .map((entry) => ({
      ...entry,
      priority: zipEntryPriority(entry.name, mimeType)
    }))
    .filter((entry) => entry.priority > 0)
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));

  if (!entries.length) {
    return "";
  }

  const pieces = [];
  let usedChars = 0;
  for (const entry of entries.slice(0, 80)) {
    const data = readZipEntry(buffer, entry);
    if (!data) {
      continue;
    }

    const entryMime = inferMimeType({ filename: entry.name, mimeType: "application/octet-stream" });
    const raw = data.toString("utf8");
    const text =
      entry.name.toLowerCase().endsWith(".xml") ||
      entry.name.toLowerCase().endsWith(".rels")
        ? xmlToText(raw)
        : decodeTextBuffer(data, entryMime);
    const normalized = normalizeExtractedText(text, Math.max(800, maxChars - usedChars));
    if (!normalized.text) {
      continue;
    }

    const includeEntryName = normalizeMimeType(mimeType) === "application/zip";
    pieces.push(includeEntryName ? `${entry.name}\n${normalized.text}` : normalized.text);
    usedChars += normalized.text.length;
    if (usedChars >= maxChars) {
      break;
    }
  }

  return pieces.join("\n\n");
}

function decodePdfString(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\\d{1,3}/g, " ");
}

function extractBasicPdfText(buffer) {
  const source = buffer.toString("latin1");
  const pieces = [];
  const textObjectPattern = /BT([\s\S]*?)ET/g;
  let objectMatch = textObjectPattern.exec(source);
  while (objectMatch && pieces.join(" ").length < DEFAULT_TEXT_LIMIT) {
    const block = objectMatch[1];
    const stringPattern = /\((?:\\.|[^\\)])*\)\s*Tj|\[((?:\s*\((?:\\.|[^\\)])*\)\s*)+)\]\s*TJ/g;
    let stringMatch = stringPattern.exec(block);
    while (stringMatch) {
      const raw = stringMatch[0];
      const values = raw.match(/\((?:\\.|[^\\)])*\)/g) || [];
      for (const value of values) {
        pieces.push(decodePdfString(value.slice(1, -1)));
      }
      stringMatch = stringPattern.exec(block);
    }
    objectMatch = textObjectPattern.exec(source);
  }

  if (pieces.length) {
    return pieces.join(" ");
  }

  return "";
}

function extractReadableBinaryText(buffer) {
  const latinText = buffer
    .toString("latin1")
    .match(/[A-Za-z0-9][\x09\x0A\x0D\x20-\x7E]{4,}/g);
  const utf16Pieces = [];

  let current = "";
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    const code = buffer[index];
    const high = buffer[index + 1];
    if (high === 0 && (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126))) {
      current += String.fromCharCode(code);
      continue;
    }

    if (current.length >= 5) {
      utf16Pieces.push(current);
    }
    current = "";
  }

  if (current.length >= 5) {
    utf16Pieces.push(current);
  }

  return [...(latinText || []), ...utf16Pieces].join("\n");
}

export function extractMediaText(buffer, options = {}) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  const maxChars = Math.max(1000, options.maxChars || DEFAULT_TEXT_LIMIT);
  const mimeType = inferMimeType(options);
  let rawText = "";
  let source = "";

  if (isTextLikeMime(mimeType)) {
    rawText = decodeTextBuffer(data, mimeType);
    source = "text";
  } else if (mimeType === "application/pdf") {
    rawText = extractBasicPdfText(data);
    source = rawText ? "pdf-basic" : "";
  } else if (isZipContainerMime(mimeType)) {
    rawText = extractZipText(data, mimeType, maxChars);
    source = rawText ? "zip-text" : "";
  } else if (isLegacyOfficeMime(mimeType)) {
    rawText = extractReadableBinaryText(data);
    source = rawText ? "binary-text" : "";
  }

  const normalized = normalizeExtractedText(rawText, maxChars);
  return {
    ...normalized,
    source,
    mimeType,
    available: Boolean(normalized.text)
  };
}

export function buildFileTextPrompt({
  caption = "",
  filename = "",
  mediaType = "document",
  mimeType = "",
  extractedText = "",
  truncated = false
} = {}) {
  const label = describeMediaAttachment({ mediaType, mimeType, filename });
  const userRequest = cleanText(caption);
  const lines = [
    `The user sent a ${label}.`,
    userRequest
      ? `Their instruction or caption was: ${userRequest}`
      : "They did not add a caption, so provide the most useful professional analysis of the file.",
    "",
    "Extracted file text:",
    extractedText,
    truncated ? "\nThe extracted text was truncated because the file is large. Focus on the available content and say briefly if more detail may exist later in the file." : ""
  ];

  return lines.filter((line) => line !== "").join("\n");
}
