import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { comparablePhone, looksLikePhone, normalizePhone } from "./lib/phones.js";

const defaults = {
  contacts: [],
  conversations: {},
  reminders: [],
  integrations: {
    googleContacts: {
      connected: false,
      tokens: null,
      oauthState: null,
      lastSyncAt: null,
      lastSyncSummary: null
    }
  },
  meta: {
    inbound: {},
    outbound: {}
  }
};

const fileNames = {
  contacts: "contacts.json",
  conversations: "conversations.json",
  reminders: "reminders.json",
  integrations: "integrations.json",
  meta: "meta.json"
};

const writeQueues = new Map();
const INBOUND_PROCESSING_STALE_MS = 10 * 60 * 1000;
const REMINDER_PROCESSING_STALE_MS = 10 * 60 * 1000;
const PERMANENT_REMINDER_ERRORS = [
  "RECIPIENT_NOT_ALLOWED",
  "INVALID_PHONE"
];
const MAX_REMINDER_ATTEMPTS = 5;

function cloneDefault(name) {
  return JSON.parse(JSON.stringify(defaults[name]));
}

function dataDir() {
  return process.env.CLAW_DATA_DIR
    ? path.resolve(process.cwd(), process.env.CLAW_DATA_DIR)
    : config.dataDir;
}

function filePath(name) {
  return path.join(dataDir(), fileNames[name]);
}

async function ensureFiles() {
  await mkdir(dataDir(), { recursive: true });

  await Promise.all(
    Object.keys(fileNames).map(async (name) => {
      const target = filePath(name);
      try {
        await readFile(target, "utf8");
      } catch {
        await writeFile(
          target,
          `${JSON.stringify(cloneDefault(name), null, 2)}\n`,
          "utf8"
        );
      }
    })
  );
}

async function readJson(name) {
  await ensureFiles();
  try {
    const content = await readFile(filePath(name), "utf8");
    return JSON.parse(content);
  } catch {
    return cloneDefault(name);
  }
}

async function writeJson(name, data) {
  await ensureFiles();
  await writeFile(filePath(name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

async function withWriteLock(name, updater) {
  const previous = writeQueues.get(name) || Promise.resolve();
  const next = previous.then(async () => {
    const current = await readJson(name);
    const updated = (await updater(current)) ?? current;
    return writeJson(name, updated);
  });

  writeQueues.set(name, next.catch(() => undefined));
  return next;
}

function nowIso() {
  return new Date().toISOString();
}

function parseTime(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function normalizeBusinessId(value) {
  return String(value || "").trim();
}

function hasScope(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, "businessId");
}

function scopeMatches(recordBusinessId, options = {}) {
  if (!hasScope(options)) {
    return !normalizeBusinessId(recordBusinessId);
  }

  return normalizeBusinessId(recordBusinessId) === normalizeBusinessId(options.businessId);
}

function entityKey(phone, businessId = "") {
  return `${normalizeBusinessId(businessId)}::${comparablePhone(phone)}`;
}

function conversationKey(chatId, options = {}) {
  const businessId = normalizeBusinessId(options.businessId);
  const normalizedChatId = normalizePhone(chatId) || String(chatId || "").trim();
  if (!normalizedChatId) {
    return "";
  }
  return businessId ? `${businessId}::${normalizedChatId}` : normalizedChatId;
}

function parseConversationKey(value) {
  const raw = String(value || "");
  const separatorIndex = raw.indexOf("::");
  if (separatorIndex === -1) {
    return {
      businessId: "",
      chatId: raw
    };
  }

  return {
    businessId: raw.slice(0, separatorIndex),
    chatId: raw.slice(separatorIndex + 2)
  };
}

function contactMatches(contact, query) {
  const lowerQuery = query.toLowerCase();
  const aliasPool = [contact.name, ...(contact.aliases || [])]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  const emailPool = (contact.emails || [])
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return (
    aliasPool.some((value) => value.includes(lowerQuery)) ||
    emailPool.some((value) => value.includes(lowerQuery)) ||
    (looksLikePhone(query) &&
      comparablePhone(contact.phone).includes(comparablePhone(query)))
  );
}

function normalizeLimit(value, fallback, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function reminderMatchesScope(reminder, options = {}) {
  return scopeMatches(reminder.businessId, options);
}

function contactMatchesScope(contact, options = {}) {
  return scopeMatches(contact.businessId, options);
}

function threadMatchesScope(threadBusinessId, options = {}) {
  return scopeMatches(threadBusinessId, options);
}

function isReminderDue(reminder, nowMs) {
  const dueAtMs = parseTime(reminder.dueAt);
  if (!Number.isFinite(dueAtMs) || dueAtMs > nowMs) {
    return false;
  }

  const nextAttemptAtMs = parseTime(reminder.nextAttemptAt || reminder.dueAt);
  return !Number.isFinite(nextAttemptAtMs) || nextAttemptAtMs <= nowMs;
}

function reminderBackoffMs(attempts) {
  const baseDelayMs = 60 * 1000;
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

async function pruneStaleInboundProcessing() {
  const staleBefore = Date.now() - INBOUND_PROCESSING_STALE_MS;

  return withWriteLock("meta", (meta) => {
    meta.inbound ||= {};

    for (const [messageId, entry] of Object.entries(meta.inbound)) {
      if (
        entry?.status === "processing" &&
        (!Number.isFinite(parseTime(entry.startedAt)) ||
          parseTime(entry.startedAt) <= staleBefore)
      ) {
        delete meta.inbound[messageId];
      }
    }

    return meta;
  });
}

function getConversationArgs(limitOrOptions, maybeOptions) {
  if (typeof limitOrOptions === "object" && limitOrOptions !== null) {
    return {
      limit: config.maxConversationMessages,
      options: limitOrOptions
    };
  }

  return {
    limit: normalizeLimit(limitOrOptions, config.maxConversationMessages, 200),
    options: maybeOptions || {}
  };
}

function getReminderArgs(targetPhoneOrOptions, maybeOptions) {
  if (typeof targetPhoneOrOptions === "object" && targetPhoneOrOptions !== null) {
    return {
      targetPhone: "",
      options: targetPhoneOrOptions
    };
  }

  return {
    targetPhone: targetPhoneOrOptions || "",
    options: maybeOptions || {}
  };
}

export async function initStore() {
  await ensureFiles();
  await pruneStaleInboundProcessing();
}

export async function listContacts(query = "", options = {}) {
  const contacts = await readJson("contacts");
  const scoped = contacts.filter((contact) => contactMatchesScope(contact, options));

  if (!query) {
    return scoped;
  }

  return scoped.filter((contact) => contactMatches(contact, query));
}

export async function resolveContact(query, fallbackPhone = "", options = {}) {
  if (
    typeof fallbackPhone === "object" &&
    fallbackPhone !== null &&
    !Array.isArray(fallbackPhone)
  ) {
    options = fallbackPhone;
    fallbackPhone = "";
  }

  if (!query || query === "current_chat" || query === "me" || query === "self") {
    if (!fallbackPhone) {
      return { status: "missing_target" };
    }
    return {
      status: "resolved",
      contact: {
        name: "Current chat",
        phone: normalizePhone(fallbackPhone),
        aliases: [],
        businessId: normalizeBusinessId(options.businessId)
      }
    };
  }

  if (looksLikePhone(query)) {
    return {
      status: "resolved",
      contact: {
        name: query,
        phone: normalizePhone(query),
        aliases: [],
        businessId: normalizeBusinessId(options.businessId)
      }
    };
  }

  const matches = await listContacts(query, options);
  if (matches.length === 1) {
    return { status: "resolved", contact: matches[0] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "not_found", matches: [] };
}

export async function upsertContact({
  businessId = "",
  name,
  phone,
  aliases = [],
  emails = [],
  overwriteName = true,
  providers = {}
}) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error("Phone is required to save a contact");
  }

  const normalizedBusinessId = normalizeBusinessId(businessId);
  const normalizedAliases = [...new Set((aliases || []).filter(Boolean))];
  const normalizedEmails = [
    ...new Set(
      (emails || [])
        .filter(Boolean)
        .map((value) => value.toLowerCase())
    )
  ];
  const normalizedProviders =
    providers && typeof providers === "object" ? providers : {};
  const hasProviderMetadata = Object.keys(normalizedProviders).length > 0;

  return withWriteLock("contacts", (contacts) => {
    const existing = contacts.find(
      (contact) =>
        comparablePhone(contact.phone) === comparablePhone(normalizedPhone) &&
        normalizeBusinessId(contact.businessId) === normalizedBusinessId
    );

    if (existing) {
      if (overwriteName && name) {
        existing.name = name;
      } else if (!existing.name && name) {
        existing.name = name;
      }
      const extraAliases = [...normalizedAliases];
      if (!overwriteName && name && name !== existing.name) {
        extraAliases.push(name);
      }
      existing.aliases = [...new Set([...(existing.aliases || []), ...extraAliases])];
      existing.emails = [
        ...new Set([...(existing.emails || []), ...normalizedEmails])
      ];
      existing.providers = {
        ...(existing.providers || {}),
        ...normalizedProviders
      };
      existing.businessId = normalizedBusinessId || "";
      existing.lastSeenAt = nowIso();
      if (hasProviderMetadata) {
        existing.lastSyncedAt = nowIso();
      }
      return contacts;
    }

    contacts.push({
      id: crypto.randomUUID(),
      businessId: normalizedBusinessId || "",
      name: name || normalizedPhone,
      phone: normalizedPhone,
      aliases: normalizedAliases,
      emails: normalizedEmails,
      providers: normalizedProviders,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      lastSyncedAt: hasProviderMetadata ? nowIso() : null
    });

    return contacts;
  });
}

export async function getGoogleContactsIntegration() {
  const integrations = await readJson("integrations");
  return (
    integrations.googleContacts || cloneDefault("integrations").googleContacts
  );
}

export async function updateGoogleContactsIntegration(updater) {
  const updated = await withWriteLock("integrations", (integrations) => {
    integrations.googleContacts ||=
      cloneDefault("integrations").googleContacts;

    const next =
      updater(integrations.googleContacts) || integrations.googleContacts;
    integrations.googleContacts = next;
    return integrations;
  });

  return updated.googleContacts;
}

export async function appendConversationMessage(chatId, message, options = {}) {
  const key = conversationKey(chatId, options);
  if (!key) {
    throw new Error("Conversation chat id is required");
  }

  const businessId = normalizeBusinessId(options.businessId);

  return withWriteLock("conversations", (conversations) => {
    const history = conversations[key] || [];
    history.push({
      id: message.id || crypto.randomUUID(),
      role: message.role,
      text: message.text,
      at: message.at || nowIso(),
      meta: {
        ...(message.meta || {}),
        ...(businessId ? { businessId } : {})
      }
    });
    conversations[key] = history.slice(-200);
    return conversations;
  });
}

export async function getConversation(chatId, limitOrOptions, maybeOptions) {
  const { limit, options } = getConversationArgs(limitOrOptions, maybeOptions);
  const conversations = await readJson("conversations");
  const key = conversationKey(chatId, options);
  return (conversations[key] || []).slice(-limit);
}

export async function listConversationThreads({ query = "", limit = 30, businessId } = {}) {
  const options = hasScope({ businessId }) ? { businessId } : {};
  const contacts = await listContacts("", options);
  const conversations = await readJson("conversations");
  const contactByScopedPhone = new Map(
    contacts.map((contact) => [entityKey(contact.phone, contact.businessId), contact])
  );
  const lowerQuery = String(query || "").trim().toLowerCase();
  const threads = [];

  for (const [storedKey, history] of Object.entries(conversations)) {
    const parsed = parseConversationKey(storedKey);
    if (!threadMatchesScope(parsed.businessId, options)) {
      continue;
    }

    const contact =
      contactByScopedPhone.get(entityKey(parsed.chatId, parsed.businessId)) ||
      contactByScopedPhone.get(entityKey(parsed.chatId, "")) ||
      null;
    const lastMessage = history[history.length - 1] || null;
    threads.push({
      businessId: parsed.businessId || "",
      chatId: parsed.chatId,
      contact: contact || {
        name: parsed.chatId,
        phone: normalizePhone(parsed.chatId),
        aliases: [],
        businessId: parsed.businessId || ""
      },
      messageCount: history.length,
      lastMessage,
      lastAt: lastMessage?.at || null
    });
  }

  const filtered = !lowerQuery
    ? threads
    : threads.filter((thread) => {
        const contact = thread.contact || {};
        const aliasPool = [contact.name, ...(contact.aliases || []), contact.phone]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        const lastText = String(thread.lastMessage?.text || "").toLowerCase();
        return (
          aliasPool.some((value) => value.includes(lowerQuery)) ||
          lastText.includes(lowerQuery)
        );
      });

  return filtered
    .sort((left, right) => {
      const leftTime = new Date(left.lastAt || 0).getTime();
      const rightTime = new Date(right.lastAt || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, normalizeLimit(limit, 30, 100));
}

export async function searchConversationHistory({
  query,
  target = "",
  limit = 12,
  businessId
} = {}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const options = hasScope({ businessId }) ? { businessId } : {};
  const contacts = await listContacts("", options);
  const conversations = await readJson("conversations");
  const contactByScopedPhone = new Map(
    contacts.map((contact) => [entityKey(contact.phone, contact.businessId), contact])
  );

  let allowedKeys = Object.keys(conversations).filter((storedKey) => {
    const parsed = parseConversationKey(storedKey);
    return threadMatchesScope(parsed.businessId, options);
  });

  if (target) {
    const resolved = await resolveContact(target, "", options);
    if (resolved.status === "resolved") {
      allowedKeys = [conversationKey(resolved.contact.phone, options)];
    } else {
      return [];
    }
  }

  const matches = [];
  for (const storedKey of allowedKeys) {
    const parsed = parseConversationKey(storedKey);
    const history = conversations[storedKey] || [];
    const contact =
      contactByScopedPhone.get(entityKey(parsed.chatId, parsed.businessId)) ||
      contactByScopedPhone.get(entityKey(parsed.chatId, "")) || {
        name: parsed.chatId,
        phone: normalizePhone(parsed.chatId),
        aliases: [],
        businessId: parsed.businessId || ""
      };

    for (const message of history) {
      const text = String(message.text || "");
      if (!text.toLowerCase().includes(needle)) {
        continue;
      }

      matches.push({
        businessId: parsed.businessId || "",
        chatId: parsed.chatId,
        contact,
        message: {
          id: message.id,
          role: message.role,
          text: message.text,
          at: message.at,
          meta: message.meta || {}
        }
      });
    }
  }

  return matches
    .sort(
      (left, right) =>
        new Date(right.message.at || 0).getTime() -
        new Date(left.message.at || 0).getTime()
    )
    .slice(0, normalizeLimit(limit, 12, 50));
}

export async function beginInboundProcessing(messageId) {
  const staleBefore = Date.now() - INBOUND_PROCESSING_STALE_MS;
  let result = { status: "accepted" };

  await withWriteLock("meta", (meta) => {
    meta.inbound ||= {};
    const existing = meta.inbound[messageId];

    if (existing?.status === "done") {
      result = { status: "duplicate" };
      return meta;
    }

    if (
      existing?.status === "processing" &&
      new Date(existing.startedAt).getTime() > staleBefore
    ) {
      result = { status: "duplicate" };
      return meta;
    }

    meta.inbound[messageId] = {
      status: "processing",
      startedAt: nowIso()
    };
    result = { status: "accepted" };
    return meta;
  });

  return result;
}

export async function getInboundProcessingResult(messageId) {
  const meta = await readJson("meta");
  return meta.inbound?.[messageId] || null;
}

export async function completeInboundProcessing(messageId, details = {}) {
  return withWriteLock("meta", (meta) => {
    meta.inbound ||= {};
    meta.inbound[messageId] = {
      ...(meta.inbound[messageId] || {}),
      ...details,
      status: "done",
      finishedAt: nowIso()
    };
    return meta;
  });
}

export async function hasRecentOutboundDedup(key, windowMs = 10 * 60 * 1000) {
  const meta = await readJson("meta");
  const record = meta.outbound?.[key];
  if (!record) {
    return false;
  }
  return Date.now() - new Date(record.at).getTime() <= windowMs;
}

export async function rememberOutboundDedup(key, details = {}) {
  return withWriteLock("meta", (meta) => {
    meta.outbound ||= {};
    meta.outbound[key] = {
      at: nowIso(),
      ...details
    };
    return meta;
  });
}

export async function createReminder({
  businessId = "",
  targetPhone,
  text,
  dueAt,
  sourceChatId,
  createdBy,
  integration = {}
}) {
  const normalizedPhone = normalizePhone(targetPhone);
  if (!normalizedPhone) {
    throw new Error("Reminder target phone is required");
  }

  return withWriteLock("reminders", (reminders) => {
    reminders.push({
      id: crypto.randomUUID(),
      businessId: normalizeBusinessId(businessId),
      targetPhone: normalizedPhone,
      text,
      dueAt,
      sourceChatId,
      createdBy,
      integration,
      status: "pending",
      createdAt: nowIso(),
      sentAt: null,
      lastError: null,
      lastAttemptAt: null,
      nextAttemptAt: dueAt,
      attempts: 0,
      failedAt: null,
      processingStartedAt: null
    });
    return reminders;
  });
}

export async function listReminders(targetPhoneOrOptions = "", maybeOptions = {}) {
  const { targetPhone, options } = getReminderArgs(targetPhoneOrOptions, maybeOptions);
  const reminders = (await readJson("reminders")).filter((reminder) =>
    reminderMatchesScope(reminder, options)
  );

  if (!targetPhone) {
    return reminders;
  }

  const comparableTarget = comparablePhone(targetPhone);
  return reminders.filter(
    (reminder) => comparablePhone(reminder.targetPhone) === comparableTarget
  );
}

export async function cancelReminder(reminderId) {
  return withWriteLock("reminders", (reminders) => {
    const reminder = reminders.find((entry) => entry.id === reminderId);
    if (!reminder) {
      throw new Error(`Reminder not found: ${reminderId}`);
    }
    reminder.status = "cancelled";
    reminder.cancelledAt = nowIso();
    return reminders;
  });
}

export async function getDueReminders(now = new Date()) {
  const reminders = await readJson("reminders");
  const nowMs = now.getTime();
  return reminders.filter(
    (reminder) => reminder.status === "pending" && isReminderDue(reminder, nowMs)
  );
}

export async function markReminderSent(reminderId, delivery = {}) {
  return withWriteLock("reminders", (reminders) => {
    const reminder = reminders.find((entry) => entry.id === reminderId);
    if (!reminder) {
      return reminders;
    }
    reminder.status = "sent";
    reminder.sentAt = nowIso();
    reminder.delivery = delivery;
    reminder.lastError = null;
    reminder.failedAt = null;
    reminder.nextAttemptAt = null;
    reminder.processingStartedAt = null;
    return reminders;
  });
}

export async function claimDueReminders(now = new Date()) {
  const nowMs = now.getTime();
  const staleBefore = nowMs - REMINDER_PROCESSING_STALE_MS;
  const claimedAt = now.toISOString();
  let claimed = [];

  await withWriteLock("reminders", (reminders) => {
    claimed = [];

    for (const reminder of reminders) {
      if (
        reminder.status === "processing" &&
        (!Number.isFinite(parseTime(reminder.processingStartedAt)) ||
          parseTime(reminder.processingStartedAt) <= staleBefore)
      ) {
        reminder.status = "pending";
        reminder.processingStartedAt = null;
      }

      if (reminder.status !== "pending" || !isReminderDue(reminder, nowMs)) {
        continue;
      }

      reminder.status = "processing";
      reminder.processingStartedAt = claimedAt;
      claimed.push({ ...reminder });
    }

    return reminders;
  });

  return claimed;
}

export async function markReminderFailed(reminderId, errorMessage) {
  return withWriteLock("reminders", (reminders) => {
    const reminder = reminders.find((entry) => entry.id === reminderId);
    if (!reminder) {
      return reminders;
    }
    const errorText = String(errorMessage || "Unknown reminder error");
    const attempts = (reminder.attempts || 0) + 1;
    reminder.attempts = attempts;
    reminder.lastError = errorText;
    reminder.lastAttemptAt = nowIso();

    const isPermanent =
      PERMANENT_REMINDER_ERRORS.some((code) => errorText.includes(code)) ||
      attempts >= MAX_REMINDER_ATTEMPTS;

    if (isPermanent) {
      reminder.status = "failed";
      reminder.failedAt = nowIso();
      reminder.nextAttemptAt = null;
      reminder.processingStartedAt = null;
      return reminders;
    }

    reminder.status = "pending";
    reminder.failedAt = null;
    reminder.processingStartedAt = null;
    reminder.nextAttemptAt = new Date(
      Date.now() + reminderBackoffMs(attempts)
    ).toISOString();

    return reminders;
  });
}
