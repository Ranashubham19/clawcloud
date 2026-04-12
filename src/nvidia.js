import { performance } from "node:perf_hooks";
import { config, requireConfig } from "./config.js";
import { toModelText } from "./lib/text.js";

export const DEFAULT_NVIDIA_MODELS = [
  "qwen/qwen3.5-397b-a17b",
  "meta/llama-3.1-405b-instruct",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mistral-medium-3-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "google/gemma-3-27b-it",
  "deepseek-ai/deepseek-v3.2",
  "qwen/qwen2.5-coder-32b-instruct"
];

const SELECTED_MODEL_LIMIT = DEFAULT_NVIDIA_MODELS.length;
const modelStats = new Map();

function uniqueModels(values) {
  const seen = new Set();
  const ordered = [];

  for (const value of values) {
    const model = String(value || "").trim();
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    ordered.push(model);
  }

  return ordered;
}

export function getConfiguredNvidiaModels() {
  const configuredModels = config.nvidiaModels.length
    ? config.nvidiaModels
    : DEFAULT_NVIDIA_MODELS;

  return uniqueModels(configuredModels).slice(0, SELECTED_MODEL_LIMIT);
}

function getModelStat(model) {
  if (!modelStats.has(model)) {
    modelStats.set(model, {
      successes: 0,
      failures: 0,
      averageLatencyMs: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0
    });
  }

  return modelStats.get(model);
}

function updateAverage(previousAverage, nextValue, count) {
  if (!count) {
    return nextValue;
  }

  return Math.round(((previousAverage * (count - 1)) + nextValue) / count);
}

function recordModelSuccess(model, latencyMs) {
  const stat = getModelStat(model);
  stat.successes += 1;
  stat.averageLatencyMs = updateAverage(
    stat.averageLatencyMs,
    Math.max(1, Math.round(latencyMs)),
    stat.successes
  );
  stat.lastSuccessAt = Date.now();
}

function recordModelFailure(model) {
  const stat = getModelStat(model);
  stat.failures += 1;
  stat.lastFailureAt = Date.now();
}

function scoreModel(model, index, preferredModels) {
  const stat = getModelStat(model);
  const now = Date.now();
  const baseScore = Math.max(0, 100 - index * 6);
  const preferredBoost = preferredModels.has(model) ? 1000 : 0;
  const successBoost = stat.successes * 12;
  const failurePenalty = stat.failures * 18;
  const latencyPenalty = Math.min(60, Math.round((stat.averageLatencyMs || 0) / 150));
  const recentSuccessBoost =
    stat.lastSuccessAt && now - stat.lastSuccessAt < 15 * 60 * 1000 ? 15 : 0;
  const recentFailurePenalty =
    stat.lastFailureAt && now - stat.lastFailureAt < 15 * 60 * 1000 ? 20 : 0;

  return (
    preferredBoost +
    baseScore +
    successBoost +
    recentSuccessBoost -
    failurePenalty -
    recentFailurePenalty -
    latencyPenalty
  );
}

export function getRankedNvidiaModels({
  preferredModels = [],
  excludeModels = []
} = {}) {
  const excluded = new Set(
    excludeModels.map((value) => String(value || "").trim()).filter(Boolean)
  );
  const preferred = new Set(
    preferredModels.map((value) => String(value || "").trim()).filter(Boolean)
  );

  return getConfiguredNvidiaModels()
    .filter((model) => !excluded.has(model))
    .map((model, index) => ({
      model,
      score: scoreModel(model, index, preferred)
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.model);
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    }
  };
}

async function requestChatCompletion({
  model,
  messages,
  tools,
  toolChoice,
  maxTokens,
  timeoutMs
}) {
  const { signal, cancel } = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(`${config.nvidiaApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.nvidiaApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.0,
        max_tokens: maxTokens,
        tools,
        tool_choice: tools.length ? toolChoice : "none"
      }),
      signal
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${details}`);
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`NVIDIA request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    cancel();
  }
}

export async function createChatCompletion({
  messages,
  tools = [],
  toolChoice = "auto",
  maxTokens = 800,
  excludeModels = [],
  preferredModels = [],
  deadlineAt = 0,
  maxAttempts = config.nvidiaMaxAttempts
}) {
  requireConfig("NVIDIA_API_KEY", config.nvidiaApiKey);

  const candidates = getRankedNvidiaModels({ preferredModels, excludeModels });
  if (!candidates.length) {
    throw new Error("No NVIDIA models are available after exclusions.");
  }

  const errors = [];
  let attempts = 0;
  const attemptLimit = Math.min(
    candidates.length,
    Math.max(1, Number.isFinite(maxAttempts) ? maxAttempts : candidates.length)
  );

  for (const model of candidates) {
    if (attempts >= attemptLimit) {
      break;
    }

    const remainingMs = deadlineAt ? deadlineAt - Date.now() : config.nvidiaTimeoutMs;
    if (remainingMs < 700) {
      break;
    }

    const timeoutMs = Math.max(
      700,
      Math.min(config.nvidiaTimeoutMs, deadlineAt ? remainingMs - 200 : config.nvidiaTimeoutMs)
    );
    const startedAt = performance.now();

    try {
      const completion = await requestChatCompletion({
        model,
        messages,
        tools,
        toolChoice,
        maxTokens,
        timeoutMs
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      recordModelSuccess(model, latencyMs);
      completion._meta = {
        ...(completion._meta || {}),
        model,
        latencyMs
      };
      return completion;
    } catch (error) {
      recordModelFailure(model);
      errors.push(`[${model}] ${error.message}`);
      attempts += 1;
    }
  }

  throw new Error(`All NVIDIA models failed: ${errors.join(" | ")}`);
}

export function unpackAssistantMessage(completion) {
  const choice = completion?.choices?.[0];
  const message = choice?.message || {};

  return {
    role: "assistant",
    text: toModelText(message.content),
    toolCalls: message.tool_calls || [],
    finishReason: choice?.finish_reason || "",
    model: completion?._meta?.model || completion?.model || ""
  };
}
