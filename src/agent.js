import { config } from "./config.js";
import { appendConversationMessage, getConversation, upsertContact } from "./store.js";
import { createChatCompletion, unpackAssistantMessage } from "./nvidia.js";
import { executeTool, toolDefinitions } from "./tools.js";
import { safeJsonParse } from "./lib/text.js";
import {
  buildProfessionalFallbackReply,
  getProfessionalQuickReply
} from "./replies.js";

const toolIntentPattern =
  /\b(send|message|text|remind|reminder|history|recent|contact|save contact|lookup|look up|find contact)\b/i;

function systemPrompt(context) {
  return [
    `You are ${config.botName}, a professional WhatsApp assistant.`,
    "Respond in a polished, trustworthy, and helpful tone.",
    "Answer normal questions directly with clear language and practical next steps when useful.",
    "Prefer 1 to 3 short paragraphs or a few bullets only when they make the answer easier to scan.",
    "Keep replies brief by default and avoid long essays unless the user asks for detail.",
    "Acknowledge the user's goal, avoid slang, and do not sound robotic.",
    "Use tools only when you need real data or real actions such as contacts, history, reminders, or sending WhatsApp messages.",
    "If the user explicitly asks to send a message and you have enough information, call send_whatsapp_message instead of writing pseudo-instructions.",
    "Never answer with fake commands like 'Send this to X'. Either send it with the tool or ask only for the missing detail.",
    "When a contact is ambiguous, ask one short clarifying question.",
    "If the request is simple, give a direct professional answer instead of overexplaining.",
    `Current timezone: ${config.timezone}.`,
    `Current ISO time: ${new Date().toISOString()}.`,
    `Current chat phone: ${context.currentUserPhone}.`,
    `Current chat profile name: ${context.profileName || "Unknown"}.`
  ].join("\n");
}

function historyToModelMessages(history) {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.text
  }));
}

function mayNeedTools(text) {
  return toolIntentPattern.test(String(text || ""));
}

export async function handleIncomingText({ messageId, from, profileName, text }) {
  await upsertContact({
    name: profileName || from,
    phone: from,
    aliases: profileName ? [profileName] : []
  });

  await appendConversationMessage(from, {
    id: messageId,
    role: "user",
    text,
    meta: { profileName }
  });

  const quickReply = getProfessionalQuickReply({ text, profileName });
  if (quickReply) {
    await appendConversationMessage(from, {
      role: "assistant",
      text: quickReply,
      meta: { source: "quick-reply" }
    });
    return quickReply;
  }

  const useTools = mayNeedTools(text);
  const history = await getConversation(from, useTools ? 24 : 12);
  const messages = [
    { role: "system", content: systemPrompt({ currentUserPhone: from, profileName }) },
    ...historyToModelMessages(history)
  ];

  let assistantText = "";
  let toolRounds = 0;
  let modelError = null;

  try {
    while (toolRounds < 6) {
      const completion = await createChatCompletion({
        messages,
        tools: useTools ? toolDefinitions : [],
        maxTokens: useTools ? 700 : 260
      });
      const assistant = unpackAssistantMessage(completion);

      if (!assistant.toolCalls.length) {
        assistantText = assistant.text;
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
    assistantText = buildProfessionalFallbackReply({ text, profileName });
  }

  await appendConversationMessage(from, {
    role: "assistant",
    text: assistantText,
    meta: modelError
      ? {
          source: "fallback",
          modelError: modelError.message
        }
      : {}
  });

  return assistantText;
}
