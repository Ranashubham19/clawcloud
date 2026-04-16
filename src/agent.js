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
  detectLanguageStyle,
  isLanguageCompatible,
  languageInstruction,
  languageLabel
} from "./lib/language.js";
import { cleanUserFacingText, safeJsonParse, sanitizeForWhatsApp } from "./lib/text.js";
import {
  geminiSearchAnswer,
  geminiMediaAnswer,
  hasGeminiProvider,
  isMimeSupported,
  normalizeMimeType,
  unsupportedFormatName
} from "./gemini.js";
import { downloadInboundMedia } from "./messaging.js";
import {
  buildBusinessSystemPrompt,
  captureLeadFromInbound,
  getLeadContextForBusiness
} from "./saas.js";

// Advanced + responsive models — preferred across all routes
const ADVANCED_MODELS = [
  "deepseek-ai/deepseek-v3.2",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-next-80b-a3b-instruct"
];

const toolIntentPattern =
  /\b(send\s+message|send\s+a\s+message|send\s+him|send\s+her|send\s+them|send\s+to|msg\s+to|text\s+to|forward\s+to|remind\s+me|reminder\s+for|schedule\s+message|save\s+contact|lookup\s+contact|look\s*up\s+contact|find\s+my\s+contact|find\s+contact|my\s+contacts|my\s+contact|my\s+chats|my\s+messages|my\s+history|my\s+whatsapp|whatsapp\s+history|whatsapp\s+chat|who\s+said|what\s+did\s+\w+\s+say|who\s+messaged|auto\s*reply|auto-reply|read\s+my\s+messages|show\s+my\s+chats|list\s+my\s+contacts|search\s+my\s+messages|check\s+my\s+chats|last\s+message\s+from|recent\s+message\s+from|whatsapp\s+overview|my\s+inbox|chat\s+with\s+\w|message\s+to\s+\w|send\s+\w+\s+a\s+message)\b/i;

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

function pickMaxTokens(text) {
  const value = String(text || "");
  const long = longAnswerPattern.test(value) || value.length > 100;
  return long ? 1500 : 800;
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

  if (
    /(?:^|\b)(web_search|lookup_contact|save_contact|get_recent_history|search_history|send_whatsapp_message|create_reminder|list_reminders|cancel_reminder|list_contacts|list_chat_threads)\s*\(/i.test(
      text
    )
  ) {
    return true;
  }

  if (/^\s*\w+\s*=\s*\w+\s*\(/i.test(text)) {
    return true;
  }

  if (/function call/i.test(text) && /\b(web_search|lookup_contact|send_whatsapp_message)\b/i.test(text)) {
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

function systemPrompt(context) {
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
    `You are ${config.botName}, a professional AI assistant inside WhatsApp.`,
    "You can answer any question on any topic across any language: general knowledge, current affairs, math, code, writing, translation, analysis, medical, legal, finance, science, and casual conversation.",
    "LANGUAGE RULE — ABSOLUTE: Reply in the exact same language and script as the user's most recent message. Telugu → Telugu, Arabic → Arabic, Hindi → Hindi in Devanagari, Hinglish → Roman Hinglish.",
    "If the user asks you to switch language (e.g. 'in hindi', 'hindi mein', 'give it in telugu', 'urdu mein batao') — immediately switch to that language for your ENTIRE response and stay in it.",
    context.languageInstruction,
    `Required language for this response: ${context.languageLabel}. Every single sentence must be in this language. Do not mix or fall back to English.`,
    "FORMATTING RULE — USE WHATSAPP FORMAT ONLY:",
    "• Use *bold* (single asterisk each side) for section headings and key terms.",
    "• Use numbered lists (1. 2. 3.) for steps, instructions, or ranked items.",
    "• Use • bullet points for unordered lists.",
    "• Leave ONE blank line between every paragraph and after every heading — this creates readable spacing.",
    "• Short factual answers: 1–3 clean sentences with no forced structure.",
    "• Long or detailed answers: divide into clear sections with *Heading* on its own line, blank line, then content.",
    "• Never write a wall of text — split content into short readable chunks.",
    "• Do NOT use Markdown syntax (##, **, __, ``` ) — use the WhatsApp formats above only.",
    "• No raw JSON, no tool-call syntax, no internal notes in replies.",
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
          "WHEN TO USE TOOLS — STRICT RULES (read carefully):",
          "- ONLY call lookup_contact when the user explicitly says things like 'message Raj', 'send to Dii', 'find my contact X', 'look up X in my contacts', 'save this contact'. NOT for general questions.",
          "- NEVER call lookup_contact for general knowledge questions like 'what is IST', 'who is Gandhi', 'what does X mean', 'tell me about X'. These are general knowledge — answer them directly.",
          "- User says 'message X' / 'send X a text' / 'tell [name] Y' → call lookup_contact then send_whatsapp_message.",
          "- User asks 'what did X say' / 'show my chat with X' / 'read messages from X' → call get_recent_history.",
          "- User asks 'show my chats' / 'list my contacts' / 'who have I talked to' → call list_chat_threads or list_contacts.",
          "- User asks for WhatsApp overview / inbox summary → call get_whatsapp_overview.",
          "- User asks to set a reminder or schedule a message → call create_reminder.",
          "- If unsure whether something is a contact name or a general topic, treat it as general knowledge and answer directly WITHOUT calling any tool.",
          "DO NOT describe what you would do. DO NOT say 'I would send'. Actually call the tool and report the result.",
          "If a contact is not found by name, ask once for the phone number. Never make up phone numbers."
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

export function directSmallTalkReply(text, languageStyle) {
  const source = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!source) {
    return "";
  }

  if (/^(how are you|how are you today|how're you|how r you|how are u|hru|how r u)\??$/.test(source)) {
    if (languageStyle === "hinglish") {
      return "Main bilkul theek hoon, shukriya! Aaj main aapki kaise madad kar sakta hoon?";
    }
    return "I'm doing great, thank you for asking! How may I assist you today?";
  }

  if (/^(hi|hello|hey|hii|hlo|helo|yo|sup|greetings|good morning|good afternoon|good evening|good night|namaste|namaskar)\!?$/.test(source)) {
    if (languageStyle === "hinglish") {
      return "Namaste! Main aapki madad ke liye yahan hoon. Aap mujhse koi bhi sawaal pooch sakte hain — main poori koshish karunga ki aapko sahi aur jaldi jawab milein.";
    }
    return "Hello! I'm here and ready to help. Feel free to ask me anything — I'll do my best to give you a clear and accurate answer.";
  }

  if (
    /^(what can you do|what can u do|what all can you do|what all you can do|what do you do|how can you help|how can you help me|what can you help me with|what are your capabilities|what are you capable of|what do you offer|tell me what you can do|what can you assist with)\??$/.test(
      source
    )
  ) {
    if (languageStyle === "hinglish") {
      return "Main aapke liye bahut kuch kar sakta hoon:\n\n• *Sawaalon ke jawab* — general knowledge, science, history, math, coding, finance, law, health aur aur bhi bahut kuch\n• *Writing mein help* — emails, essays, summaries, translations\n• *Explain karna* — koi bhi topic ko simple language mein\n• *Planning* — travel, projects, daily tasks\n• *WhatsApp actions* — message bhejne, contacts dhundne, reminders set karne mein bhi help\n\nBas apna sawaal bhejiye — main direct aur clear jawab dunga.";
    }
    return "Here's what I can help you with:\n\n• *Answering questions* — general knowledge, science, history, math, coding, finance, law, health, and much more\n• *Writing assistance* — emails, essays, summaries, translations\n• *Explaining topics* — breaking down complex subjects simply\n• *Planning & advice* — travel, projects, decisions, daily tasks\n• *WhatsApp actions* — sending messages, finding contacts, setting reminders\n\nJust send me your question — I'll give you a direct, accurate answer.";
  }

  if (/^(who are you|what are you|are you a bot|are you ai|are you human|are you a robot|are you an ai|are you chatgpt|who made you|who created you)\??$/.test(source)) {
    if (languageStyle === "hinglish") {
      return `Main ${config.botName} hoon — ek professional AI assistant jo aapke WhatsApp pe available hai. Main aapke sawaalo ka jawab dene ke liye yahan hoon. Aap kya jaanna chahte hain?`;
    }
    return `I'm ${config.botName}, a professional AI assistant available right here on WhatsApp. I'm here to answer your questions and help you get things done. What would you like to know?`;
  }

  if (/^(thanks|thank you|thank u|thx|ty|great|awesome|nice|good|perfect|excellent|amazing|wonderful)\!?$/.test(source)) {
    if (languageStyle === "hinglish") {
      return "Khushi hui madad karke! Koi aur sawaal ho toh zaroor poochein.";
    }
    return "You're welcome! Feel free to ask if there's anything else I can help you with.";
  }

  if (/^(ok|okay|alright|got it|i see|understood|sure|fine)\!?$/.test(source)) {
    if (languageStyle === "hinglish") {
      return "Bilkul! Koi bhi sawaal ho toh poochein.";
    }
    return "Of course! Let me know whenever you have a question.";
  }

  return "";
}

export async function handleIncomingText({
  messageId,
  from,
  profileName,
  text,
  businessContext = null
}) {
  const languageStyle = detectLanguageStyle(text);
  const answerRoute = businessContext ? "business" : chooseAnswerRoute(text);
  const useTools = businessContext ? false : shouldUseWhatsAppTools(text);
  const useGeminiFirst = businessContext ? false : answerRoute === "gemini-first";
  const businessId = businessContext?.id || "";
  let nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;
  let leadCapture = { lead: null, booking: null };

  await upsertContact({
    businessId,
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });

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

  if (businessContext) {
    leadCapture = await captureLeadFromInbound({
      business: businessContext,
      message: {
        messageId,
        from,
        profileName,
        text
      }
    });
  }

  if (!businessContext) {
    const smallTalkReply = directSmallTalkReply(text, languageStyle);
    if (smallTalkReply) {
      await appendConversationMessage(
        from,
        {
          role: "assistant",
          text: smallTalkReply,
          meta: { source: "small-talk-direct" }
        },
        { businessId }
      );
      return smallTalkReply;
    }
  }

  let history = [];

  if (useGeminiFirst) {
    const geminiAnswer = await getGeminiAnswer(
      text,
      languageStyle,
      Date.now() + config.geminiTimeoutMs
    );
    if (geminiAnswer) {
      const geminiText = cleanUserFacingText(geminiAnswer);
      if (
        geminiText &&
        !isToolLeakText(geminiText) &&
        isLanguageCompatible(geminiText, languageStyle)
      ) {
        await appendConversationMessage(
          from,
          {
            role: "assistant",
            text: geminiText,
            meta: { source: "gemini-first" }
          },
          { businessId }
        );
        return geminiText;
      }
    }
    nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;
    history = await getConversation(from, 6, { businessId });
  } else {
    history = await getConversation(from, useTools ? 10 : 6, { businessId });
  }

  const preferredModels = resolvePreferredModels(answerRoute);
  const leadContext =
    leadCapture.lead || (businessContext ? await getLeadContextForBusiness(businessContext, from) : null);
  const waContext = useTools ? await loadWhatsAppContext({ businessId }) : { contactCount: 0, threadCount: 0, contactList: "" };

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
    ...historyToModelMessages(history)
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
    assistantText = "Sorry, I couldn't generate a response right now. Please try again in a moment.";
  }

  assistantText = sanitizeForWhatsApp(assistantText);

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
  mediaType,
  mimeType,
  caption,
  filename,
  businessContext = null
}) {
  const languageStyle = detectLanguageStyle(caption || "");
  const businessId = businessContext?.id || "";

  await upsertContact({
    businessId,
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });

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
    const fallback = "I can't process media files right now — GEMINI_API_KEY is not configured. Please send a text message instead.";
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} }, {
      businessId
    });
    return fallback;
  }

  // Download the media file from WhatsApp
  let mediaData, resolvedMime;
  try {
    const downloaded = await downloadInboundMedia(
      mediaId,
      businessContext?.messagingConfig || businessContext?.whatsappConfig || {}
    );
    mediaData = downloaded.data;
    resolvedMime = downloaded.mimeType;
  } catch (dlError) {
    console.error(`[agent] Media download failed for ${mediaId}: ${dlError.message}`);
    const fallback = "Sorry, I couldn't download that file from WhatsApp. Please try sending it again.";
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

  const assistantText = sanitizeForWhatsApp(cleanUserFacingText(answer));

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
