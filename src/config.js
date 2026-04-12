import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile(path.resolve(process.cwd(), ".env"));

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: toInt(process.env.PORT, 3000),
  timezone: process.env.TIMEZONE || "Asia/Calcutta",
  dataDir: path.resolve(process.cwd(), process.env.CLAW_DATA_DIR || "./data"),
  botName: process.env.BOT_NAME || "Claw Cloud",
  appBaseUrl: process.env.APP_BASE_URL || "",
  adminApiToken: process.env.ADMIN_API_TOKEN || "",
  nvidiaApiKey: process.env.NVIDIA_API_KEY || "",
  nvidiaModel:
    process.env.NVIDIA_MODEL || "qwen/qwen3.5-397b-a17b",
  nvidiaModels: String(process.env.NVIDIA_MODELS || "")
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean),
  nvidiaApiBase:
    process.env.NVIDIA_API_BASE || "https://integrate.api.nvidia.com/v1",
  nvidiaTimeoutMs: toInt(process.env.NVIDIA_TIMEOUT_MS, 120000),
  nvidiaMaxAttempts: toInt(process.env.NVIDIA_MAX_ATTEMPTS, 10),
  tavilyApiKey: process.env.TAVILY_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  geminiTimeoutMs: toInt(process.env.GEMINI_TIMEOUT_MS, 30000),
  searchTimeoutMs: toInt(process.env.SEARCH_TIMEOUT_MS, 1800),
  replyLatencyBudgetMs: toInt(process.env.REPLY_LATENCY_BUDGET_MS, 600000),
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v22.0",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  googleContactsScope:
    process.env.GOOGLE_CONTACTS_SCOPE ||
    "https://www.googleapis.com/auth/contacts.readonly",
  reminderPollIntervalMs: toInt(process.env.REMINDER_POLL_INTERVAL_MS, 15000),
  maxConversationMessages: toInt(process.env.MAX_CONVERSATION_MESSAGES, 40)
};

export function requireConfig(name, value) {
  if (!value) {
    throw new Error(`Missing required config: ${name}`);
  }
}
