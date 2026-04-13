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
import { geminiSearchAnswer, geminiMediaAnswer, hasGeminiProvider } from "./gemini.js";
import { downloadWhatsAppMedia } from "./whatsapp.js";

// Advanced + responsive models — preferred across all routes
const ADVANCED_MODELS = [
  "deepseek-ai/deepseek-v3.2",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-next-80b-a3b-instruct"
];

const toolIntentPattern =
  /\b(send|message|msg|text|reply|forward|remind|reminder|schedule|history|contact|contacts|save\s+contact|lookup\s+contact|look\s*up\s+contact|find\s+contact|call\s+log|whatsapp|wa|chat|chats|thread|threads|conversation|conversations|unread|who\s+said|what\s+did|who\s+messaged|my\s+contacts|my\s+chats|my\s+messages|my\s+history|auto\s*reply|auto-reply|read\s+my|show\s+my|list\s+my|search\s+my|check\s+my|broadcast|last\s+message|recent\s+message|overview|inbox)\b/i;

// Live/recency queries — always routed to Gemini for real-time Google Search grounding
const liveQueryPattern =
  /\b(price|prices|rate|rates|rating|ratings|today|tonight|now|current|currently|latest|recent|recently|live|trending|trend|news|update|updates|market|stock|crypto|bitcoin|ethereum|btc|eth|forecast|prediction|weather|score|scores|match|matches|result|results|standings|leaderboard|2024|2025|2026)\b/i;


const longAnswerPattern =
  /\b(explain|describe|write|code|program|function|algorithm|solution|essay|article|story|poem|list|steps|tutorial|guide|how\s+to|in\s+detail|detailed|complete|full|long|implement|implementation|debug|analyze|analysis|compare|difference|pros\s+and\s+cons)\b/i;

async function getGeminiAnswer(query, languageStyle, deadlineAt = 0) {
  if (hasGeminiProvider()) {
    const answer = await geminiSearchAnswer({
      query,
      languageStyle,
      maxOutputTokens: 620,
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

async function loadWhatsAppContext() {
  try {
    const [contacts, threads] = await Promise.all([
      listContacts(""),
      listConversationThreads({ limit: 200 })
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
  const lines = [
    `You are ${config.botName}, an advanced AI assistant with FULL CONTROL over this WhatsApp account.`,
    "You can answer any question on any topic across any language: general knowledge, current affairs, math, code, writing, translation, analysis, medical, legal, finance, science, and casual conversation.",
    "LANGUAGE RULE — ABSOLUTE: Reply in the exact same language and script as the user's most recent message. Telugu → Telugu, Arabic → Arabic, Hindi → Hindi in Devanagari, Hinglish → Roman Hinglish. Never switch unless explicitly asked.",
    context.languageInstruction,
    `Required language style: ${context.languageLabel}. Every sentence must be in this language.`,
    "FORMATTING RULE: Plain text only. No Markdown, no asterisks, no hashtags, no backticks. Bullets use '- '. No raw JSON ever.",
    "Be warm, intelligent, and direct. Give real answers first, context after. Never sound scripted.",
    "ANSWER DEPTH: Complete and accurate always. Short for simple questions, detailed for hard ones. Never cut off mid-answer.",
    "FORMAT REMINDER: Never output raw JSON, tool-call syntax, function arguments, or internal notes to the user.",
    "Never mention tools, searching, models, or internal workflow to the user.",
    `Current timezone: ${config.timezone}.`,
    `Current ISO time: ${new Date().toISOString()}.`,
    `Current chat phone: ${context.currentUserPhone}.`,
    `Current chat profile name: ${context.profileName || "Unknown"}.`,
    `Stored contacts: ${context.contactCount} contacts saved. Stored chat threads: ${context.threadCount}.`,
    context.contactList ? `Known contacts include: ${context.contactList}.` : "",
    "WHATSAPP CONTROL — FULL ACCESS:",
    "You have complete read and write access to this WhatsApp account through tools.",
    "Tools available: get_whatsapp_overview, list_contacts, list_chat_threads, lookup_contact, save_contact, get_recent_history, search_history, send_whatsapp_message, create_reminder, list_reminders, cancel_reminder.",
    "WHEN TO USE TOOLS — MANDATORY RULES:",
    "- User asks about contacts or 'who is X' → call lookup_contact or list_contacts immediately.",
    "- User asks 'what did X say', 'show me my chat with X', 'read my messages from X' → call get_recent_history.",
    "- User asks to search messages, find a conversation, look for something said → call search_history.",
    "- User says 'message X', 'send X a text', 'tell mom Y', 'forward this to Z' → call lookup_contact then send_whatsapp_message.",
    "- User asks 'show my chats', 'list my threads', 'who have I talked to' → call list_chat_threads.",
    "- User asks for overview, inbox, summary of WhatsApp → call get_whatsapp_overview.",
    "- User asks to set a reminder or schedule a message → call create_reminder.",
    "DO NOT describe what you would do. DO NOT say 'I would send'. Actually call the tool and report the result.",
    "If a contact is not found by name, ask once for the phone number. Never make up phone numbers."
  ].filter(Boolean);

  return lines.join("\n");
}

function mayNeedTools(text) {
  // Tools always available for nvidia routes so the model can act on WhatsApp freely
  const route = chooseAnswerRoute(text);
  return route === "nvidia-tools" || route === "nvidia";
}

function historyToModelMessages(history) {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.text
  }));
}

export async function handleIncomingText({ messageId, from, profileName, text }) {
  const languageStyle = detectLanguageStyle(text);
  const answerRoute = chooseAnswerRoute(text);
  const useTools = mayNeedTools(text);
  const useGeminiFirst = answerRoute === "gemini-first";
  let nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;

  await upsertContact({
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });


  await appendConversationMessage(from, {
    id: messageId,
    role: "user",
    text,
    meta: { profileName }
  });

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
        await appendConversationMessage(from, {
          role: "assistant",
          text: geminiText,
          meta: { source: "gemini-first" }
        });
        return geminiText;
      }
    }
    nvidiaDeadlineAt = Date.now() + config.replyLatencyBudgetMs;
    history = await getConversation(from, 6);
  } else {
    // Load more history for tool routes so "this contact" / "them" resolves correctly
    history = await getConversation(from, useTools ? 10 : 6);
  }

  const preferredModels = resolvePreferredModels(answerRoute);

  const waContext = await loadWhatsAppContext();

  const messages = [
    {
      role: "system",
      content: systemPrompt({
        currentUserPhone: from,
        profileName,
        languageInstruction: languageInstruction(languageStyle),
        languageLabel: languageLabel(languageStyle),
        contactCount: waContext.contactCount,
        threadCount: waContext.threadCount,
        contactList: waContext.contactList
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
          inboundMessageId: messageId
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

  await appendConversationMessage(from, {
    role: "assistant",
    text: assistantText,
    meta: {}
  });

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
  filename
}) {
  const languageStyle = detectLanguageStyle(caption || "");

  await upsertContact({
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : [],
    overwriteName: false
  });

  await appendConversationMessage(from, {
    id: messageId,
    role: "user",
    text: caption
      ? `[${mediaType} — ${filename || mimeType}] ${caption}`
      : `[${mediaType} — ${filename || mimeType}]`,
    meta: { profileName, mediaType, mimeType, filename }
  });

  if (!hasGeminiProvider()) {
    const fallback = "I can't process media files right now — GEMINI_API_KEY is not configured. Please send a text message instead.";
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} });
    return fallback;
  }

  // Download the media file from WhatsApp
  let mediaData, resolvedMime;
  try {
    const downloaded = await downloadWhatsAppMedia(mediaId);
    mediaData = downloaded.data;
    resolvedMime = downloaded.mimeType;
  } catch (dlError) {
    console.error(`[agent] Media download failed for ${mediaId}: ${dlError.message}`);
    const fallback = "Sorry, I couldn't download that file from WhatsApp. Please try sending it again.";
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} });
    return fallback;
  }

  const TWENTY_MB = 20 * 1024 * 1024;
  if (mediaData.length > TWENTY_MB) {
    const fallback = `That file is too large to process (${Math.round(mediaData.length / 1024 / 1024)}MB). Please send files under 20MB.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} });
    return fallback;
  }

  let answer;
  try {
    const deadlineAt = Date.now() + config.geminiTimeoutMs;
    answer = await geminiMediaAnswer({
      mediaData,
      mimeType: resolvedMime || mimeType,
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

  if (!answer) {
    const fallback = caption
      ? `I received your ${mediaType} but couldn't analyse it right now. You mentioned: "${caption}". Could you describe what you need help with?`
      : `I received your ${mediaType} but couldn't analyse it right now. Please try again in a moment or describe what you need.`;
    await appendConversationMessage(from, { role: "assistant", text: fallback, meta: {} });
    return fallback;
  }

  const assistantText = sanitizeForWhatsApp(cleanUserFacingText(answer));

  await appendConversationMessage(from, {
    role: "assistant",
    text: assistantText,
    meta: { source: "gemini-media" }
  });

  return assistantText;
}
