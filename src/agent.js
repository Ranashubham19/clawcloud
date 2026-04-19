import { config } from "./config.js";
import {
  appendConversationMessage,
  getConversation,
  listContacts,
  listConversationThreads,
  upsertContact
} from "./store.js";
import { createChatCompletion, unpackAssistantMessage, getRankedNvidiaModels } from "./nvidia.js";
import { executeTool, toolDefinitions } from "./tools.js";
import {
  isLanguageCompatible,
  languageInstruction,
  languageLabel,
  resolveReplyLanguageStyle
} from "./lib/language.js";
import {
  cleanUserFacingText,
  formatProfessionalReply,
  formatSourceAttribution,
  safeJsonParse,
  sanitizeForWhatsApp
} from "./lib/text.js";
import {
  geminiSearchAnswer,
  geminiMediaAnswer,
  hasGeminiProvider,
  isMimeSupported,
  normalizeMimeType,
  unsupportedFormatName
} from "./gemini.js";
import { downloadInboundMedia } from "./messaging.js";
import { downloadTelegramMedia } from "./telegram.js";
import { buildBusinessSystemPrompt } from "./saas.js";

// Advanced + responsive models — preferred across all routes
const ADVANCED_MODELS = [
  "deepseek-ai/deepseek-v3.2",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-next-80b-a3b-instruct"
];

const toolIntentPattern =
  /\b(send\s+message|send\s+a\s+message|send\s+him|send\s+her|send\s+them|send\s+to|msg\s+to|text\s+to|forward\s+to|remind\s+me|reminder\s+for|schedule\s+message|save\s+contact|lookup\s+contact|look\s*up\s+contact|find\s+my\s+contact|find\s+contact|my\s+contacts|my\s+contact|my\s+chats|my\s+messages|my\s+history|my\s+whatsapp|whatsapp\s+history|whatsapp\s+chat|who\s+said|what\s+did\s+\w+\s+say|who\s+messaged|auto\s*reply|auto-reply|read\s+my\s+messages|show\s+my\s+chats|list\s+my\s+contacts|search\s+my\s+messages|check\s+my\s+chats|last\s+message\s+from|recent\s+message\s+from|whatsapp\s+overview|my\s+inbox|chat\s+with\s+\w|message\s+to\s+\w|send\s+\w+\s+a\s+message|tell\s+me\s+message|message\s+of\s+\w|messages\s+of\s+\w|messages\s+from\s+\w|show\s+message|read\s+message|get\s+message|fetch\s+message|message\s+from\s+\w|chat\s+of\s+\w|conversation\s+of\s+\w|conversation\s+with\s+\w|history\s+of\s+\w|history\s+with\s+\w|whatsapp\s+contact|contact\s+named|contact\s+called|contact\s+have|have\s+.*\s+contact|do\s+i\s+have|is\s+.*\s+in\s+my|in\s+my\s+contact|in\s+my\s+whatsapp|search\s+contact|check\s+contact|number\s+of\s+\w|phone\s+of\s+\w|add\s+contact|delete\s+contact|remove\s+contact|update\s+contact|contact\s+list|all\s+contacts|show\s+contacts|get\s+contacts)\b/i;

// Live/recency queries — routed to Gemini for real-time Google Search grounding
// Covers: finance, news, sports, weather, geopolitics, current events, recent facts
const liveQueryPattern =
  /\b(price|prices|rate|rates|rating|today|tonight|now|current|currently|latest|recent|recently|live|trending|news|update|updates|market|stock|crypto|bitcoin|ethereum|btc|eth|forecast|weather|score|scores|match|matches|result|results|standings|leaderboard|2024|2025|2026|happening|happened|what\s+is\s+happening|breaking|announced|announcement|declared|decision|verdict|ruling|election|vote|voted|won|lost|winner|loser|war|attack|strike|missile|bomb|invasion|troops|army|ceasefire|cease.?fire|peace\s+deal|treaty|sanction|sanctions|agreement|deal|negotiation|negotiations|condition|conditions|demand|demands|proposal|summit|meeting|talks|conflict|crisis|tension|protest|rally|riot|casualt|killed|death|toll|victim|hostage|refugee|diplomat|diplomacy|nuclear|weapon|military|defense|nato|un\s+resolution|security\s+council|iran|israel|ukraine|russia|china|pakistan|india|us\s+president|prime\s+minister|government|parliament|congress|senate|policy|law|bill|passed|signed|launch|launched|released|revealed|discovered|found|arrested|charged|convicted|sentenced|fire|earthquake|flood|disaster|accident|crash|explosion)\b/i;


const longAnswerPattern =
  /\b(explain|describe|write|code|program|function|algorithm|solution|essay|article|story|poem|list|steps|tutorial|guide|how\s+to|in\s+detail|detailed|complete|full|long|implement|implementation|debug|analyze|analysis|compare|difference|pros\s+and\s+cons)\b/i;

async function getGeminiAnswer(query, languageStyle, deadlineAt = 0) {
  if (hasGeminiProvider()) {
    const answer = await geminiSearchAnswer({
      query,
      languageStyle,
      maxOutputTokens: 1200,
      deadlineAt
    });
    if (answer) {
      return answer;
    }
  }
  return null;
}

function formatGroundedAnswer(text, sources = [], supports = [], channel = "default", languageStyle = "english") {
  const answerText = formatProfessionalReply(text, { languageStyle });
  if (!answerText) {
    return "";
  }

  const attribution = formatSourceAttribution(sources, {
    includeHeading: false,
    urlOnly: true
  });
  if (!attribution) {
    return answerText;
  }

  return `${answerText}\n\n${attribution}`;
}

function pickMaxTokens(text) {
  const value = String(text || "");
  const long = longAnswerPattern.test(value) || value.length > 100;
  return long ? 2500 : 1200;
}

async function loadWhatsAppContext(options = {}) {
  try {
    const [contacts, threads] = await Promise.all([
      listContacts("", { businessId: options.businessId || "" }),
      listConversationThreads({ limit: 200, businessId: options.businessId || "" })
    ]);
    const contactList = contacts
      .slice(0, 40)
      .map((c) => `${c.name} (${c.phone})`)
      .join(", ");
    return {
      contactCount: contacts.length,
      threadCount: threads.length,
      contactList: contactList || "none yet"
    };
  } catch {
    return { contactCount: 0, threadCount: 0, contactList: "none yet" };
  }
}

function resolvePreferredModels(route) {
  if (route === "nvidia" || route === "nvidia-tools") {
    return ADVANCED_MODELS;
  }
  return ADVANCED_MODELS;
}

export function chooseAnswerRoute(text) {
  const value = String(text || "");
  // WhatsApp tool operations → NVIDIA with tools
  if (toolIntentPattern.test(value)) {
    return "nvidia-tools";
  }
  // Live/current/2025-era queries → Gemini with Google Search grounding
  // If Gemini fails, falls back to NVIDIA automatically
  if (liveQueryPattern.test(value)) {
    return "gemini-first";
  }
  // Everything else (general, coding, math, science, history, language, advice…)
  // → 10 NVIDIA models only
  return "nvidia";
}

export function isToolLeakText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  // Known tool names or any get_/search_/lookup_ invented tool as function call
  if (
    /(?:^|\b)(web_search|lookup_contact|save_contact|get_recent_history|search_history|send_whatsapp_message|create_reminder|list_reminders|cancel_reminder|list_contacts|list_chat_threads|get_definition|get_meaning|get_info|get_weather|get_news|get_\w+|search_\w+|lookup_\w+|fetch_\w+|find_\w+)\s*[\(\{]/i.test(text)
  ) {
    return true;
  }

  if (/^\s*\w+\s*=\s*\w+\s*\(/i.test(text)) {
    return true;
  }

  if (/function call/i.test(text) && /\b(web_search|lookup_contact|send_whatsapp_message)\b/i.test(text)) {
    return true;
  }

  // Detect JSON tool call format anywhere in text
  if (/"name"\s*:\s*"[\w_]+"[\s\S]*?"parameters"/i.test(text)) {
    return true;
  }

  // Detect escaped/corrupted tool call patterns like \get_definition\
  if (/\\(?:get|search|lookup|find|create|send|list|cancel|save|fetch)_\w+/i.test(text)) {
    return true;
  }

  // Detect tool call fragments like: { name: get_definition, parameters:
  if (/\b(name|parameters|arguments)\s*[:\\]\s*[\w\\]+_\w+/i.test(text)) {
    return true;
  }

  if (!(text.startsWith("{") || text.startsWith("[") || /^```json/i.test(text))) {
    return false;
  }

  return /"(name|parameters|arguments|tool_call|function)"\s*:/i.test(text);
}

function mergeContinuationText(base, addition) {
  const left = String(base || "").trim();
  const right = String(addition || "").trim();

  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (left.includes(right)) {
    return left;
  }

  const overlapLimit = Math.min(220, left.length, right.length);
  for (let size = overlapLimit; size >= 40; size -= 1) {
    if (left.endsWith(right.slice(0, size))) {
      return `${left}${right.slice(size)}`.trim();
    }
  }

  return `${left}\n\n${right}`.trim();
}

async function continueIfTruncated({
  baseMessages,
  text,
  finishReason,
  preferredModel,
  excludeModels,
  languageStyle,
  deadlineAt
}) {
  let combined = String(text || "").trim();
  let nextFinishReason = finishReason;
  let rounds = 0;
  let workingMessages = [...baseMessages];

  while (combined && nextFinishReason === "length" && rounds < 1) {
    if (deadlineAt && deadlineAt - Date.now() < 1200) {
      break;
    }

    workingMessages = [
      ...workingMessages,
      { role: "assistant", content: combined },
      {
        role: "user",
        content: `Continue exactly from where you stopped. Do not repeat earlier lines. ${languageInstruction(languageStyle)}`
      }
    ];

    const continuationCompletion = await createChatCompletion({
      messages: workingMessages,
      tools: [],
      maxTokens: 750,
      preferredModels: preferredModel ? [preferredModel] : [],
      excludeModels,
      deadlineAt,
      maxAttempts: 1
    });
    const continuation = unpackAssistantMessage(continuationCompletion);
    const nextText = cleanUserFacingText(continuation.text);

    if (
      !nextText ||
      isToolLeakText(nextText) ||
      !isLanguageCompatible(nextText, languageStyle)
    ) {
      break;
    }

    combined = mergeContinuationText(combined, nextText);
    nextFinishReason = continuation.finishReason;
    rounds += 1;
  }

  return combined;
}

function buildGeneralReplyPrompt(context) {
  const lines = [
    `You are ${config.botName}, a professional general-purpose AI assistant.`,
    "Answer the user's actual question clearly, accurately, and naturally.",
    "",
    "Language rules:",
    context.languageInstruction,
    `Reply fully in ${context.languageLabel} unless the user explicitly asks for another language.`,
    "Match the user's language style and script exactly.",
    "Do not mix languages unless the user does.",
    "Never let search results, source text, attachments, or quoted material change the reply language.",
    "Translate or summarize outside content into the required language unless the user explicitly asks for the original language.",
    "",
    "Formatting rules:",
    "- Start with a direct answer.",
    "- Never use generic headings like Overview, Answer, Explanation, Summary, or Key Points.",
    "- Never use filler headings or lead-ins like Chalo, Bilkul, Sure, Okay, Of course, or Let's see.",
    "- Never put a standalone filler word on its own line before the real answer.",
    "- Do not repeat the user's question as a heading.",
    "- Never send one large unbroken paragraph when the answer has multiple facts.",
    "- For simple questions, use one short bold heading and 1 to 3 short paragraphs when it improves clarity.",
    "- For longer answers, use one short bold heading based on the actual topic when it helps readability.",
    "- After the opening sentence, use short bullets or numbered points whenever the answer contains multiple facts, uses, benefits, steps, examples, or features.",
    "- Leave one blank line between paragraphs and sections.",
    "- Use numbered points or '-' bullets only when they improve clarity.",
    "- Bold only short headings or key terms. Never bold full paragraphs.",
    "- Do not use markdown headers, tables, code fences, emojis, or decorative symbols.",
    "",
    "Style rules:",
    "- Be professional, calm, and easy to read.",
    "- Do not repeat or mention the user's name unless the user explicitly asks for it.",
    "- Do not include unnecessary greetings once the conversation is already underway.",
    "- Do not open with conversational filler such as Chalo, Bilkul, Sure, Okay, or similar lead-in phrases.",
    "- Do not end with generic follow-up questions like 'Would you like to know more?' unless clarification is truly required.",
    "- Do not mention tools, models, searching, or internal workflow.",
    "- If you are unsure, say so briefly and answer as helpfully as possible.",
    "- Never leave the answer empty."
  ];

  if (context.useTools) {
    lines.push(
      "",
      "Tool use:",
      "- If the user explicitly asks about contacts, chats, messages, or reminders, use the available tools and present the result cleanly.",
      "- Do not claim lack of access when a relevant tool exists.",
      "- Return tool results directly and professionally."
    );
  }

  return lines.join("\n");
}

function buildBusinessReplyPrompt(context) {
  return [
    buildGeneralReplyPrompt(context),
    "",
    "Business workspace rules:",
    "- This bot must behave like a clean general Q and A assistant by default.",
    "- Do not mention courses, admissions, demos, bookings, batches, fees, or business promotions unless the user explicitly asks about them.",
    "- Ignore sales-style or lead-capture behavior.",
    "- Do not steer the user toward services or ask marketing follow-up questions."
  ].join("\n");
}

function systemPrompt(context) {
  return context.business
    ? buildBusinessReplyPrompt(context)
    : buildGeneralReplyPrompt(context);

  if (context.business) {
    return buildBusinessSystemPrompt({
      business: context.business,
      languageInstruction: context.languageInstruction,
      languageLabel: context.languageLabel,
      currentUserPhone: context.currentUserPhone,
      profileName: context.profileName,
      lead: context.lead,
      booking: context.booking
    });
  }

  const lines = [
    "FORMATTING IS MANDATORY — EVERY SINGLE RESPONSE MUST FOLLOW THIS STRUCTURE:",
    "• Bold the key topic name inline: *TopicName* is ... (single asterisk, never double)",
    "• After the intro sentence, leave a blank line, then use a section label followed by a numbered or bullet list (3–5 items max)",
    "• VARY the section label based on what you are answering — NEVER repeat 'Key facts:' every time. Use the right label for the topic:",
    "  - Food / spice / ingredient → 'Why it's special:' or 'What makes it unique:'",
    "  - Place / landmark / city → 'Why it's famous:' or 'What makes it iconic:'",
    "  - Person / celebrity / historical figure → 'Key achievements:' or 'Why they matter:'",
    "  - Science / medicine / health → 'How it works:' or 'Health benefits:' or 'Key properties:'",
    "  - History / event → 'Why it matters:' or 'Key moments:'",
    "  - Technology / app / tool → 'Key features:' or 'What it does:'",
    "  - Animal / nature → 'Interesting facts:' or 'What makes it unique:'",
    "  - Definition / concept / word → 'How it's used:' or 'Main types:' or 'Quick breakdown:'",
    "  - Country / culture → 'What defines it:' or 'Key highlights:'",
    "• Leave ONE blank line between sections",
    "• End with one short closing sentence",
    "• NEVER write a plain paragraph wall — always use the structure above",
    "• Do NOT use ##, **, or ``` — WhatsApp single asterisk *bold* only",
    `You are ${config.botName}, a professional AI assistant running directly ON this user's own WhatsApp account.`,
    "You have direct database access to this account's contacts, chat history, and conversations — this is NOT external data, this is the user's OWN private data stored on this server.",
    "You can answer any question on any topic in ANY language in the world: general knowledge, current affairs, math, code, writing, translation, analysis, medical, legal, finance, science, and casual conversation.",
    "GLOBAL LANGUAGE RULE — NON-NEGOTIABLE:",
    "1. Detect the language the user is writing in — ANY language on earth — and reply ENTIRELY in that same language.",
    "2. If the user explicitly requests a different language (e.g. 'in Hindi', 'en español', 'auf Deutsch', 'en français', 'بالعربي', 'em português') — switch immediately and stay in it for your ENTIRE reply.",
    "3. NEVER default to English unless the user wrote in English. French user → French reply. Spanish user → Spanish reply. Russian user → Russian reply. Arabic user → Arabic reply. German user → German reply. And so on for ALL languages.",
    "4. Use the correct native script for every language: Arabic/Urdu/Persian → Arabic script; Hindi/Marathi/Nepali → Devanagari; Russian/Ukrainian/Bulgarian → Cyrillic; Greek → Greek script; Hebrew → Hebrew script; Bengali/Tamil/Telugu/Kannada/Malayalam/Gujarati/Punjabi/Sinhala → their respective scripts; Chinese/Japanese/Korean/Thai/Khmer/Burmese → their native scripts.",
    "5. Do NOT mix languages mid-response unless the user themselves mixed them.",
    context.languageInstruction,
    `REQUIRED LANGUAGE FOR THIS RESPONSE: ${context.languageLabel}. Every single sentence must be in this language. Mixing or switching to English is forbidden unless the user asked for English.`,
    "Be warm, confident, professional, and direct. Answer the user's actual question first, then add supporting detail only when it helps.",
    "Never sound scripted, robotic, evasive, or overly salesy.",
    "For greetings, small talk, or 'what can you do' type messages, reply briefly and naturally like a polished human assistant.",
    "CRITICAL: Never volunteer or recite stored contact names, phone numbers, chat history, or account data unless the user explicitly asks a WhatsApp-specific action.",
    "If you are unsure, say only what you can support confidently. Do not invent facts. Ask one concise clarifying question only when it is genuinely required.",
    "Never say you are a large language model, never describe your emotions or lack of emotions, and never explain your internal nature unless the user explicitly asks.",
    "ANSWER DEPTH: Complete and accurate always. Short for simple questions, detailed for hard ones. Never cut off mid-answer.",
    "Never mention tools, searching, models, or internal workflow to the user.",
    `Current timezone: ${config.timezone}.`,
    `Current ISO time: ${new Date().toISOString()}.`,
    `Current chat phone: ${context.currentUserPhone}.`,
    `Current chat profile name: ${context.profileName || "Unknown"}.`,
    context.useTools
      ? `Stored contacts: ${context.contactCount} contacts saved. Stored chat threads: ${context.threadCount}.`
      : "",
    context.useTools && context.contactList
      ? `Known contacts include: ${context.contactList}.`
      : "",
    context.useTools
      ? [
          "WHATSAPP CONTROL — FULL ACCESS:",
          "You have complete read and write access to this WhatsApp account through tools.",
          "Tools available: get_whatsapp_overview, list_contacts, list_chat_threads, lookup_contact, save_contact, get_recent_history, search_history, send_whatsapp_message, create_reminder, list_reminders, cancel_reminder.",
          "WHATSAPP DATA ACCESS — YOU HAVE FULL ACCESS TO THIS ACCOUNT:",
          "This user's contacts, messages, and chat history are stored in YOUR database. You are not an outside AI — you ARE this account's assistant with real read/write access.",
          "ABSOLUTE RULES — NO EXCEPTIONS:",
          "1. NEVER say 'I cannot access', 'I don't have access', 'I can't view', or 'that's private'. These phrases are FORBIDDEN.",
          "2. ALWAYS call the tool first. Report what the tool returns. That's it.",
          "3. If a contact is not found → say 'No contact named [X] found in your saved contacts.' Ask if they want to try a phone number search.",
          "4. If history is empty → say 'No conversation history found with [X] in the system yet.'",
          "WHAT TO DO FOR EACH REQUEST:",
          "• 'Do I have [name]?' / 'Is [name] in my contacts?' / 'Does my WhatsApp have [name]?' → call list_contacts with query=[name], report results",
          "• 'Find [name]' / 'Look up [name]' → call lookup_contact with query=[name], report results",
          "• 'Show my contacts' / 'List contacts' / 'All contacts' → call list_contacts, report full list",
          "• 'Conversation with [name]' / 'Messages from [name]' / 'What did [name] say?' / 'Chat of [name]' → call get_recent_history with target=[name]",
          "• 'Search messages for [keyword]' → call search_history",
          "• 'My chats' / 'Who have I talked to?' → call list_chat_threads",
          "• 'Message [name]' / 'Send [name]...' → call lookup_contact then send_whatsapp_message",
          "• 'Remind me...' → call create_reminder",
          "• 'Overview' / 'Inbox summary' → call get_whatsapp_overview",
          "DO NOT describe what you would do. Call the tool. Return the real result to the user professionally."
        ].join("\n")
      : ""
  ].filter(Boolean);

  return lines.join("\n");
}

export function shouldUseWhatsAppTools(text) {
  // Only explicit WhatsApp/account actions should unlock tool access.
  return chooseAnswerRoute(text) === "nvidia-tools";
}

function historyToModelMessages(history) {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.text
  }));
}

function stripFormatting(text) {
  return String(text || "")
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*•·]\s+/gm, "")
    .replace(/^[ \t]*\d+[.)]\s+/gm, "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*+/g, "")
    .replace(/_{2,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function directSmallTalkReply(text, languageStyle) {
  const source = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const normalizedLanguage =
    languageStyle === "hinglish" || languageStyle === "english"
      ? languageStyle
      : "";
  if (!source) {
    return "";
  }

  if (!normalizedLanguage) {
    return "";
  }

  if (/^(how are you|how are you today|how're you|how r you|how are u|hru|how r u)\??$/.test(source)) {
    if (normalizedLanguage === "hinglish") {
      return "Main theek hoon, shukriya. Main aapki kis baat mein madad kar sakta hoon?";
    }
    return "I'm doing well, thank you. How may I assist you today?";
  }

  if (/^(hi|hello|hey|hii|hlo|helo|yo|sup|greetings|good morning|good afternoon|good evening|good night|namaste|namaskar)\!?$/.test(source)) {
    if (normalizedLanguage === "hinglish") {
      return "Namaste. Main aapki madad ke liye yahan hoon. Aap apna sawal bhej sakte hain, aur main spasht jawab dunga.";
    }
    return "Hello! I'm here to help. Ask me any question, and I'll do my best to give a clear and accurate answer.";
  }

  if (
    /^(what can you do|what can u do|what all can you do|what all you can do|what do you do|how can you help|how can you help me|what can you help me with|what are your capabilities|what are you capable of|what do you offer|tell me what you can do|what can you assist with)\??$/.test(
      source
    )
  ) {
    if (normalizedLanguage === "hinglish") {
      return "Main sawalon ke spasht aur professional jawab de sakta hoon, concepts samjha sakta hoon, writing, coding, math, planning aur rozmarra problem-solving mein madad kar sakta hoon. Aap koi bhi sawal pooch sakte hain, main seedha aur sahi jawab dunga.";
    }
    return "I can answer questions clearly and professionally, explain concepts, help with writing, coding, math, planning, and everyday problem-solving. Send me any question, and I'll give you a direct and accurate answer.";
  }

  if (/^(who are you|what are you|are you a bot|are you ai|are you human|are you a robot|are you an ai|are you chatgpt|who made you|who created you)\??$/.test(source)) {
    if (normalizedLanguage === "hinglish") {
      return `Main ${config.botName} hoon, ek professional AI assistant. Main aapke sawalon ke jawab dene ke liye yahan hoon. Aap apna sawal bhej sakte hain.`;
    }
    return `I'm ${config.botName}, a professional AI assistant. I'm here to answer your questions clearly and helpfully. What would you like to know?`;
  }

  if (/^(thanks|thank you|thank u|thx|ty|great|awesome|nice|good|perfect|excellent|amazing|wonderful)\!?$/.test(source)) {
    if (normalizedLanguage === "hinglish") {
      return "Aapka swagat hai. Agar koi aur sawaal ho, pooch sakte hain.";
    }
    return "You're welcome! Feel free to ask if there's anything else I can help you with.";
  }

  if (/^(ok|okay|alright|got it|i see|understood|sure|fine)\!?$/.test(source)) {
    if (normalizedLanguage === "hinglish") {
      return "Theek hai. Jab bhi sawaal ho, bhej dijiye.";
    }
    return "Understood. Send a question whenever you're ready.";
  }

  return "";
}

const contactQueryPattern =
  /\b(do\s+i\s+have|is\s+.+\s+in\s+my|does\s+my\s+whatsapp\s+have|find\s+contact|search\s+contact|look\s*up\s+contact|in\s+my\s+contact|in\s+my\s+whatsapp|contact\s+named|contact\s+called|contact\s+have|add\s+contact|save\s+contact|list\s+contact|show\s+contact|all\s+contact|my\s+contact|find\s+.+\s+number|number\s+of\s+.+|phone\s+of\s+.+)\b/i;

const historyQueryPattern =
  /\b(conversation\s+(of|with)|messages?\s+(of|from|with)|chat\s+(of|with)|history\s+(of|with)|what\s+did\s+\w+\s+say|tell\s+me\s+message|show\s+message|read\s+message|message\s+of\s+\w|recent\s+message\s+from|last\s+message\s+from)\b/i;

async function preExecuteWhatsAppQuery(text, businessId) {
  const lower = text.toLowerCase();

  if (historyQueryPattern.test(text)) {
    const nameMatch = lower.match(
      /(?:conversation|messages?|chat|history|message)\s+(?:of|from|with)\s+([a-z0-9 ]+?)(?:\s+with\s+me)?(?:\s*$|\?)/i
    ) || lower.match(/what\s+did\s+([a-z]+)\s+say/i) || lower.match(/tell\s+me\s+message\s+of\s+([a-z]+)/i);
    const name = nameMatch ? nameMatch[1].trim() : "";
    if (name) {
      const contacts = await listContacts(name, { businessId });
      if (contacts.length > 0) {
        const contact = contacts[0];
        const msgs = await getConversation(contact.phone, 15, { businessId });
        if (msgs.length > 0) {
          const formatted = msgs.map(
            (m) => `[${m.role === "user" ? contact.name || contact.phone : "Bot"}]: ${m.text}`
          ).join("\n");
          return `TOOL RESULT — conversation with ${contact.name || name} (${contact.phone}):\n${formatted}`;
        }
        return `TOOL RESULT — No conversation history found with ${contact.name || name} in the system yet.`;
      }
      return `TOOL RESULT — No contact named "${name}" found in saved contacts.`;
    }
  }

  if (contactQueryPattern.test(text)) {
    const nameMatch = lower.match(
      /(?:have|contact|find|search|look\s*up|is|does\s+my\s+whatsapp\s+have)\s+([a-z0-9 ]+?)(?:\s+(?:name|contact|number|in\s+my|saved))?\s*\??$/i
    );
    const name = nameMatch ? nameMatch[1].trim() : "";
    if (name && name.length > 1 && !/^(a|my|the|in|any|some)$/.test(name)) {
      const contacts = await listContacts(name, { businessId });
      if (contacts.length > 0) {
        const list = contacts.slice(0, 10).map(
          (c) => `• *${c.name || "Unknown"}* — ${c.phone}`
        ).join("\n");
        return `TOOL RESULT — Found ${contacts.length} contact(s) matching "${name}":\n${list}`;
      }
      return `TOOL RESULT — No contact named "${name}" found in saved contacts.`;
    }
    const all = await listContacts("", { businessId });
    if (all.length > 0) {
      const list = all.slice(0, 20).map((c) => `• *${c.name || "Unknown"}* — ${c.phone}`).join("\n");
      return `TOOL RESULT — ${all.length} saved contact(s):\n${list}`;
    }
    return `TOOL RESULT — No contacts saved yet.`;
  }

  return null;
}

export async function handleIncomingText({
  messageId,
  from,
  profileName,
  text,
  businessContext = null,
  deliveryChannel = "default"
}) {
  const answerRoute = chooseAnswerRoute(text);
  const useTools = businessContext ? false : shouldUseWhatsAppTools(text);
  const useGeminiFirst = answerRoute === "gemini-first";
  const businessId = businessContext?.id || "";
  const historyLimit = useGeminiFirst ? 6 : useTools ? 10 : 6;
  let nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;
  let leadCapture = { lead: null, booking: null };

  await upsertContact({
    businessId,
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });

  const previousHistory = await getConversation(from, historyLimit, { businessId });
  const languageStyle = resolveReplyLanguageStyle(text, previousHistory);

  await appendConversationMessage(
    from,
    {
      id: messageId,
      role: "user",
      text,
      meta: { profileName }
    },
    { businessId }
  );

  const history = [...previousHistory, { role: "user", text }];

  const smallTalkReply = directSmallTalkReply(text, languageStyle);
  if (smallTalkReply) {
    const formattedSmallTalkReply = formatProfessionalReply(smallTalkReply, {
      languageStyle
    });
    await appendConversationMessage(
      from,
      {
        role: "assistant",
        text: formattedSmallTalkReply,
        meta: { source: "small-talk-direct" }
      },
      { businessId }
    );
    return formattedSmallTalkReply;
  }

  if (useGeminiFirst) {
    const geminiAnswer = await getGeminiAnswer(
      text,
      languageStyle,
      Date.now() + config.geminiTimeoutMs
    );
    if (geminiAnswer) {
      const geminiText = cleanUserFacingText(geminiAnswer.text);
      if (
        geminiText &&
        !isToolLeakText(geminiText) &&
        isLanguageCompatible(geminiText, languageStyle)
      ) {
        const groundedReply = sanitizeForWhatsApp(
          formatGroundedAnswer(
            geminiAnswer.text,
            geminiAnswer.sources || [],
            geminiAnswer.supports || [],
            deliveryChannel,
            languageStyle
          )
        );
        await appendConversationMessage(
          from,
          {
            role: "assistant",
            text: groundedReply,
            meta: {
              source: "gemini-first",
              grounded: Array.isArray(geminiAnswer.sources) && geminiAnswer.sources.length > 0,
              sources: Array.isArray(geminiAnswer.sources)
                ? geminiAnswer.sources.slice(0, 6)
                : []
            }
          },
          { businessId }
        );
        return groundedReply;
      }
    }
    nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;
  }

  const preferredModels = resolvePreferredModels(answerRoute);
  const leadContext = leadCapture.lead || null;
  const waContext = useTools ? await loadWhatsAppContext({ businessId }) : { contactCount: 0, threadCount: 0, contactList: "" };

  const preResult = useTools ? await preExecuteWhatsAppQuery(text, businessId) : null;

  if (preResult) {
    const directReply = preResult
      .replace(/^TOOL RESULT — /, "")
      .trim();
    const formattedDirectReply = formatProfessionalReply(directReply, { languageStyle });
    await appendConversationMessage(
      from,
      { role: "assistant", text: formattedDirectReply, meta: { source: "pre-execute-direct" } },
      { businessId }
    );
    return formattedDirectReply;
  }

  const messages = [
    {
      role: "system",
      content: systemPrompt({
        business: businessContext,
        currentUserPhone: from,
        profileName,
        languageInstruction: languageInstruction(languageStyle),
        languageLabel: languageLabel(languageStyle),
        contactCount: waContext.contactCount,
        threadCount: waContext.threadCount,
        contactList: waContext.contactList,
        lead: leadContext,
        booking: leadCapture.booking,
        useTools
      })
    },
    ...historyToModelMessages(history),
    ...(preResult
      ? [{ role: "system", content: `${preResult}\n\nPresent this data to the user in a professional, formatted WhatsApp reply. Do not say you cannot access anything — the data above is real and already fetched.` }]
      : [])
  ];

  let assistantText = "";
  let toolRounds = 0;
  let modelError = null;
  const rejectedModels = new Set();
  const maxRejectedModels = getRankedNvidiaModels({ preferredModels }).length;

  try {
    while (toolRounds < 6) {
      const completion = await createChatCompletion({
        messages,
        tools: useTools ? toolDefinitions : [],
        maxTokens: pickMaxTokens(text),
        preferredModels,
        excludeModels: [...rejectedModels],
        deadlineAt: nvidiaDeadlineAt,
        maxAttempts: 10
      });
      const assistant = unpackAssistantMessage(completion);

      if (!assistant.toolCalls.length) {
        const cleanedAssistantText = cleanUserFacingText(assistant.text);
        let rejectAndRetry = false;

        if (!cleanedAssistantText && assistant.model) {
          rejectedModels.add(assistant.model);
          if (rejectedModels.size < maxRejectedModels) {
            rejectAndRetry = true;
          }
        }

        if (isToolLeakText(cleanedAssistantText) && assistant.model) {
          rejectedModels.add(assistant.model);
          if (rejectedModels.size < maxRejectedModels) {
            rejectAndRetry = true;
          }
        }

        if (!isLanguageCompatible(cleanedAssistantText, languageStyle) && assistant.model) {
          rejectedModels.add(assistant.model);
          if (rejectedModels.size < maxRejectedModels) {
            // Push a hard correction into the conversation before retrying
            messages.push({ role: "assistant", content: cleanedAssistantText });
            messages.push({
              role: "user",
              content: `WRONG LANGUAGE. Rewrite your entire previous response entirely in ${languageLabel(languageStyle)}. Keep the same meaning, but use only ${languageLabel(languageStyle)}. Do not switch to the language of search results, quoted text, sources, or articles unless the user explicitly asked for it.`
            });
            rejectAndRetry = true;
          }
        }

        if (rejectAndRetry) {
          continue;
        }

        assistantText = await continueIfTruncated({
          baseMessages: messages,
          text: cleanedAssistantText,
          finishReason: assistant.finishReason,
          preferredModel: assistant.model,
          excludeModels: [...rejectedModels],
          languageStyle,
          deadlineAt: nvidiaDeadlineAt
        });

        if (assistantText) {
          break;
        }

        break;
      }

      messages.push({
        role: "assistant",
        content: assistant.text || "",
        tool_calls: assistant.toolCalls
      });

      for (const toolCall of assistant.toolCalls) {
        const args = safeJsonParse(toolCall.function?.arguments || "{}", {});
        const toolResult = await executeTool(toolCall.function.name, args, {
          currentUserPhone: from,
          profileName,
          inboundMessageId: messageId,
          businessId,
          whatsappIntegration:
            businessContext?.messagingConfig || businessContext?.whatsappConfig || {}
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }

      toolRounds += 1;
    }
  } catch (error) {
    modelError = error;
  }

  if (!String(assistantText || "").trim()) {
    const errMsg = modelError ? modelError.message : "no usable model answer";
    console.error(`[agent] All models failed for ${from}: ${errMsg}`);
    const fallbacks = {
      hindi: "क्षमा करें, अभी जवाब देने में समस्या हो रही है। कृपया एक पल बाद फिर से कोशिश करें। 🙏",
      hinglish: "Sorry yaar, abhi response nahi aa raha. Ek minute baad phir try karo! 🙏",
      bengali: "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন। 🙏",
      gujarati: "માફ કરશો, અત્યારે જવાબ આપવામાં સમસ્યા છે. કૃપા કરીને થોડી વાર પછી ફરી પ્રયાસ કરો. 🙏",
      punjabi: "ਮਾਫ਼ ਕਰਨਾ, ਹੁਣੇ ਜਵਾਬ ਦੇਣ ਵਿੱਚ ਸਮੱਸਿਆ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਥੋੜੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ। 🙏",
      tamil: "மன்னிக்கவும், இப்போது பதில் அளிக்க இயலவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும். 🙏",
      telugu: "క్షమించండి, ప్రస్తుతం సమాధానం ఇవ్వడంలో సమస్య ఉంది. కొంత సేపటి తర్వాత మళ్ళీ ప్రయత్నించండి. 🙏",
      kannada: "ಕ್ಷಮಿಸಿ, ಈಗ ಉತ್ತರಿಸಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. 🙏",
      malayalam: "ക്ഷമിക്കണം, ഇപ്പോൾ മറുപടി നൽകുന്നതിൽ പ്രശ്‌നമുണ്ട്. കുറച്ചു സമയം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ. 🙏",
      arabic: "آسف، لا أستطيع الرد الآن. يرجى المحاولة مرة أخرى بعد لحظة. 🙏",
      urdu: "معذرت، ابھی جواب دینے میں مشکل ہے۔ براہ کرم ایک لمحے بعد دوبارہ کوشش کریں۔ 🙏",
      french: "Désolé, je ne peux pas répondre en ce moment. Veuillez réessayer dans un instant. 🙏",
      spanish: "Lo siento, no puedo responder ahora mismo. Por favor, inténtalo de nuevo en un momento. 🙏",
      portuguese: "Desculpe, não consigo responder agora. Por favor, tente novamente em um momento. 🙏",
      german: "Entschuldigung, ich kann gerade nicht antworten. Bitte versuche es gleich noch einmal. 🙏",
      italian: "Scusa, non riesco a rispondere in questo momento. Per favore riprova tra un attimo. 🙏",
      russian: "Извините, сейчас не могу ответить. Пожалуйста, попробуйте ещё раз через мгновение. 🙏",
      chinese: "抱歉，暂时无法回复。请稍后再试。🙏",
      japanese: "申し訳ありません、今は返答できません。少し後でもう一度お試しください。🙏",
      korean: "죄송합니다, 지금은 응답할 수 없습니다. 잠시 후 다시 시도해 주세요. 🙏",
      thai: "ขออภัย ไม่สามารถตอบได้ในขณะนี้ กรุณาลองอีกครั้งในอีกสักครู่ 🙏",
      turkish: "Üzgünüm, şu anda yanıt veremiyorum. Lütfen bir an sonra tekrar deneyin. 🙏",
      indonesian: "Maaf, saya tidak bisa membalas sekarang. Silakan coba lagi sebentar lagi. 🙏",
      malay: "Maaf, saya tidak dapat membalas sekarang. Sila cuba lagi sebentar lagi. 🙏",
      vietnamese: "Xin lỗi, tôi không thể trả lời ngay bây giờ. Vui lòng thử lại sau một lúc. 🙏",
      filipino: "Paumanhin, hindi ako makasagot ngayon. Pakisubukan muli pagkatapos ng ilang sandali. 🙏",
      swahili: "Samahani, siwezi kujibu sasa. Tafadhali jaribu tena baada ya muda. 🙏",
      polish: "Przepraszam, nie mogę teraz odpowiedzieć. Spróbuj ponownie za chwilę. 🙏"
    };
    assistantText = fallbacks[languageStyle] || "Sorry, I couldn't generate a response right now. Please try again in a moment.";
  }

  assistantText = sanitizeForWhatsApp(
    formatProfessionalReply(assistantText, { languageStyle })
  );

  await appendConversationMessage(
    from,
    {
      role: "assistant",
      text: assistantText,
      meta: {}
    },
    { businessId }
  );

  return assistantText;
}

export async function handleIncomingMedia({
  messageId,
  from,
  profileName,
  mediaId,
  fileId,
  telegramToken,
  mediaType,
  mimeType,
  caption,
  filename,
  businessContext = null
}) {
  const businessId = businessContext?.id || "";

  await upsertContact({
    businessId,
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });

  const previousHistory = await getConversation(from, 8, { businessId });
  const languageStyle = resolveReplyLanguageStyle(caption || "", previousHistory);

  await appendConversationMessage(
    from,
    {
    id: messageId,
    role: "user",
    text: caption
      ? `[${mediaType} — ${filename || mimeType}] ${caption}`
      : `[${mediaType} — ${filename || mimeType}]`,
      meta: { profileName, mediaType, mimeType, filename }
    },
    { businessId }
  );

  if (businessContext && caption) {
    await captureLeadFromInbound({
      business: businessContext,
      message: {
        messageId,
        from,
        profileName,
        text: caption
      }
    });
  }

  if (!hasGeminiProvider()) {
    // No vision AI — reply via text model with media context so the user still gets a helpful response
    const mediaLabel = filename ? `${mediaType} file (${filename})` : mediaType;
    const syntheticText = caption
      ? `[User sent a ${mediaLabel}] ${caption}`
      : `[User sent a ${mediaLabel}]`;
    const deliveryChannel = fileId ? "telegram" : "whatsapp";
    const reply = await handleIncomingText({
      messageId,
      from,
      profileName,
      text: syntheticText,
      businessContext,
      deliveryChannel
    });
    return reply;
  }

  // Download the media file (WhatsApp or Telegram)
  let mediaData, resolvedMime;
  const isTelegram = Boolean(fileId && telegramToken);
  try {
    if (isTelegram) {
      mediaData = await downloadTelegramMedia(telegramToken, fileId);
      resolvedMime = mimeType || "";
    } else {
      const downloaded = await downloadInboundMedia(
        mediaId,
        businessContext?.messagingConfig || businessContext?.whatsappConfig || {}
      );
      mediaData = downloaded.data;
      resolvedMime = downloaded.mimeType;
    }
  } catch (dlError) {
    console.error(`[agent] Media download failed for ${isTelegram ? fileId : mediaId}: ${dlError.message}`);
    const platform = isTelegram ? "Telegram" : "WhatsApp";
    const fallback = `Sorry, I couldn't download that file from ${platform}. Please try sending it again.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} }, {
      businessId
    });
    return fallback;
  }

  const effectiveMime = resolvedMime || mimeType;

  // Detect unsupported formats before even trying Gemini
  if (!isMimeSupported(effectiveMime)) {
    const formatName = unsupportedFormatName(effectiveMime);
    const ext = filename ? filename.split(".").pop().toUpperCase() : "";
    const label = ext || formatName;
    const fallback = caption
      ? `I received your ${label} file. I can't read the file contents directly, but you mentioned: "${caption}". What would you like help with?`
      : `I received your ${label} file. I can't read this format directly. Supported formats are: images (JPG, PNG, GIF, WEBP), audio (MP3, OGG, WAV, AAC), video (MP4, MOV, AVI, WEBM), and documents (PDF, HTML, CSV, TXT). Please convert the file or paste the text content directly.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} }, {
      businessId
    });
    return fallback;
  }

  const TWENTY_MB = 20 * 1024 * 1024;
  if (mediaData.length > TWENTY_MB) {
    const fallback = `That file is too large to process (${Math.round(mediaData.length / 1024 / 1024)}MB). Please send files under 20MB.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} }, {
      businessId
    });
    return fallback;
  }

  const businessSysPrompt = businessContext
    ? buildBusinessSystemPrompt({
        business: businessContext,
        languageInstruction: languageInstruction(languageStyle),
        languageLabel: languageLabel(languageStyle),
        currentUserPhone: from,
        profileName,
        lead: null,
        booking: null
      })
    : "";

  let answer;
  try {
    const deadlineAt = Date.now() + config.geminiMediaTimeoutMs;
    answer = await geminiMediaAnswer({
      mediaData,
      mimeType: effectiveMime,
      mediaType,
      caption,
      filename,
      languageStyle,
      businessSystemPrompt: businessSysPrompt,
      deadlineAt
    });
  } catch (geminiError) {
    console.warn(`[agent] Gemini media error for ${mediaType}: ${geminiError.message}`);
    answer = null;
  }

  // NVIDIA text fallback — if Gemini couldn't process the file, use NVIDIA with context
  if (!answer && caption) {
    try {
      const waContext = await loadWhatsAppContext({ businessId });
      const fallbackMessages = [
        {
          role: "system",
          content: systemPrompt({
            business: businessContext,
            currentUserPhone: from,
            profileName,
            languageInstruction: languageInstruction(languageStyle),
            languageLabel: languageLabel(languageStyle),
            contactCount: waContext.contactCount,
            threadCount: waContext.threadCount,
            contactList: waContext.contactList
          })
        },
        {
          role: "user",
          content: `The user sent a ${mediaType} file${filename ? ` (${filename})` : ""}. You cannot see the file content directly. Their message/caption was: "${caption}". Please respond helpfully to what they said.`
        }
      ];

      const fallbackCompletion = await createChatCompletion({
        messages: fallbackMessages,
        tools: [],
        maxTokens: 800,
        preferredModels: ADVANCED_MODELS,
        excludeModels: [],
        deadlineAt: Date.now() + 60000,
        maxAttempts: 3
      });
      const fallbackAssistant = unpackAssistantMessage(fallbackCompletion);
      const fallbackText = cleanUserFacingText(fallbackAssistant.text);
      if (fallbackText && !isToolLeakText(fallbackText)) {
        answer = fallbackText;
      }
    } catch (nvidiaError) {
      console.warn(`[agent] NVIDIA media fallback failed: ${nvidiaError.message}`);
    }
  }

  if (!answer) {
    const fallback = caption
      ? `I received your ${mediaType} but couldn't analyse it right now. You mentioned: "${caption}". Could you describe what you need help with?`
      : `I received your ${mediaType} but couldn't process it right now. Please try again in a moment, or send it as a different format.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} }, {
      businessId
    });
    return fallback;
  }

  const assistantText = sanitizeForWhatsApp(
    formatProfessionalReply(answer, { languageStyle })
  );

  await appendConversationMessage(
    from,
    {
      role: "assistant",
      text: assistantText,
      meta: { source: "gemini-media" }
    },
    { businessId }
  );

  return assistantText;
}
