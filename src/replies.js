import { config } from "./config.js";

const greetingPattern =
  /\b(hi|hii|hello|hey|good morning|good afternoon|good evening|greetings)\b/i;
const wellbeingPattern = /\b(how are you|how r u|how are u|how're you)\b/i;
const thanksPattern = /\b(thank you|thanks|thx)\b/i;
const helpPattern =
  /\b(help|support|what can you do|what do you do|menu|services)\b/i;

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

  const wordCount = cleaned.split(" ").filter(Boolean).length;

  if (wellbeingPattern.test(cleaned) && wordCount <= 8) {
    return `I'm doing well, thank you${namedGreeting(profileName)}. How may I assist you today?`;
  }

  if (greetingPattern.test(cleaned) && wordCount <= 6) {
    return `Hello${namedGreeting(profileName)}. Thank you for contacting ${config.botName}. How may I assist you today?`;
  }

  if (thanksPattern.test(cleaned) && wordCount <= 8) {
    return `You're welcome${namedGreeting(profileName)}. If you need anything else, I'm here to help.`;
  }

  if (helpPattern.test(cleaned) && wordCount <= 8) {
    return `I can help with questions, reminders, recent chat context, and sending WhatsApp messages when you request it. Tell me what you need, and I'll assist you clearly and professionally.`;
  }

  return "";
}

export function buildProfessionalFallbackReply({ text, profileName }) {
  const quickReply = getProfessionalQuickReply({ text, profileName });
  if (quickReply) {
    return quickReply;
  }

  return `Thank you for your message${namedGreeting(profileName)}. I'm here to help. Please share a little more detail, and I'll reply with a clear and professional answer.`;
}
