import { config, requireConfig } from "./config.js";
import { toModelText } from "./lib/text.js";

export async function createChatCompletion({ messages, tools = [], toolChoice = "auto" }) {
  requireConfig("NVIDIA_API_KEY", config.nvidiaApiKey);

  const commonHeaders = {
    Authorization: `Bearer ${config.nvidiaApiKey}`,
    "Content-Type": "application/json"
  };
  const genericPayload = {
    model: config.nvidiaModel,
    messages,
    temperature: 0.2,
    max_tokens: 1200,
    tools,
    tool_choice: tools.length ? toolChoice : "none"
  };
  const directPayload = {
    messages,
    temperature: 0.2,
    max_tokens: 1200,
    tools,
    tool_choice: tools.length ? toolChoice : "none"
  };

  const attempts = [
    {
      url: `${config.nvidiaApiBase}/chat/completions`,
      body: genericPayload
    },
    {
      url: `${config.nvidiaApiBase}/${config.nvidiaModel}`,
      body: directPayload
    }
  ];

  let lastError = "Unknown NVIDIA API failure";

  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(attempt.body)
    });

    if (response.ok) {
      return response.json();
    }

    const details = await response.text();
    lastError = `NVIDIA API error ${response.status} at ${attempt.url}: ${details}`;

    if (response.status !== 404) {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
}

export function unpackAssistantMessage(completion) {
  const choice = completion?.choices?.[0];
  const message = choice?.message || {};
  return {
    role: "assistant",
    text: toModelText(message.content),
    toolCalls: message.tool_calls || []
  };
}
