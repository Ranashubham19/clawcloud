import { config } from "./config.js";

const pureGreetingPattern =
  /^(hi+|hello+|hey+|hola|namaste|salaam|salam|assalamu?\s*alaikum|good\s+(morning|afternoon|evening|night))[\s.!?]*$/i;
const pureWellbeingPattern =
  /^(how\s+(are|r)\s+(you|u|ya))[\s.!?]*$/i;
const pureThanksPattern = /^(thank\s*you|thanks|thx|ty)[\s.!?]*$/i;

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function displayName(profileName) {
  const first = cleanText(profileName).split(" ")[0] || "";
  if (!first || /^[+\d]/.test(first)) {
    return "";
  }
  return first;
}

function namedGreeting(profileName) {
  const name = displayName(profileName);
  return name ? ` ${name}` : "";
}

export function getProfessionalQuickReply({ text, profileName }) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return "";
  }

  if (pureWellbeingPattern.test(cleaned)) {
    return `I'm doing well, thank you${namedGreeting(profileName)}. How may I assist you today?`;
  }

  if (pureGreetingPattern.test(cleaned)) {
    return `Hello${namedGreeting(profileName)}. I'm ${config.botName}, your AI assistant. How may I help you today?`;
  }

  if (pureThanksPattern.test(cleaned)) {
    return `You're welcome${namedGreeting(profileName)}. If you need anything else, I'm here to help.`;
  }

  return "";
}

export function buildProfessionalFallbackReply({ text, profileName }) {
  const quickReply = getProfessionalQuickReply({ text, profileName });
  if (quickReply) {
    return quickReply;
  }

  return `Thank you for your message${namedGreeting(profileName)}. I'm ${config.botName}, here to help. Could you share a little more detail so I can give you a precise answer?`;
}
