import { config } from "./config.js";
import { appendConversationMessage, getConversation, upsertContact } from "./store.js";
import { createChatCompletion, unpackAssistantMessage } from "./nvidia.js";
import { executeTool, toolDefinitions } from "./tools.js";
import { safeJsonParse } from "./lib/text.js";

function systemPrompt(context) {
  return [
    `You are ${config.botName}, a single-brain WhatsApp assistant.`,
    "Answer normal questions directly.",
    "Use tools only when you need real data or real actions such as contacts, history, reminders, or sending WhatsApp messages.",
    "If the user explicitly asks to send a message and you have enough information, call send_whatsapp_message instead of writing pseudo-instructions.",
    "Never answer with fake commands like 'Send this to X'. Either send it with the tool or ask only for the missing detail.",
    "When a contact is ambiguous, ask a short clarifying question.",
    "Keep replies clear, accurate, and concise for WhatsApp.",
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

  const history = await getConversation(from);
  const messages = [
    { role: "system", content: systemPrompt({ currentUserPhone: from, profileName }) },
    ...historyToModelMessages(history)
  ];

  let assistantText = "";
  let toolRounds = 0;

  while (toolRounds < 6) {
    const completion = await createChatCompletion({
      messages,
      tools: toolDefinitions
    });
    const assistant = unpackAssistantMessage(completion);

    if (!assistant.toolCalls.length) {
      assistantText = assistant.text || "Done.";
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

  await appendConversationMessage(from, {
    role: "assistant",
    text: assistantText
  });

  return assistantText;
}
