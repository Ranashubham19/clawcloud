import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { comparablePhone, looksLikePhone, normalizePhone } from "./lib/phones.js";

const defaults = {
  contacts: [],
  conversations: {},
  reminders: [],
  meta: {
    inbound: {},
    outbound: {}
  }
};

const fileNames = {
  contacts: "contacts.json",
  conversations: "conversations.json",
  reminders: "reminders.json",
  meta: "meta.json"
};

const writeQueues = new Map();

function cloneDefault(name) {
  return JSON.parse(JSON.stringify(defaults[name]));
}

function filePath(name) {
  const dataDir = process.env.CLAW_DATA_DIR
    ? path.resolve(process.cwd(), process.env.CLAW_DATA_DIR)
    : config.dataDir;
  return path.join(dataDir, fileNames[name]);
}

async function ensureFiles() {
  await mkdir(config.dataDir, { recursive: true });

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

function contactMatches(contact, query) {
  const lowerQuery = query.toLowerCase();
  const aliasPool = [contact.name, ...(contact.aliases || [])]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return (
    aliasPool.some((value) => value.includes(lowerQuery)) ||
    (looksLikePhone(query) &&
      comparablePhone(contact.phone).includes(comparablePhone(query)))
  );
}

export async function initStore() {
  await ensureFiles();
}

export async function listContacts(query = "") {
  const contacts = await readJson("contacts");
  if (!query) {
    return contacts;
  }

  return contacts.filter((contact) => contactMatches(contact, query));
}

export async function resolveContact(query, fallbackPhone = "") {
  if (!query || query === "current_chat" || query === "me" || query === "self") {
    if (!fallbackPhone) {
      return { status: "missing_target" };
    }
    return {
      status: "resolved",
      contact: {
        name: "Current chat",
        phone: normalizePhone(fallbackPhone),
        aliases: []
      }
    };
  }

  if (looksLikePhone(query)) {
    return {
      status: "resolved",
      contact: {
        name: query,
        phone: normalizePhone(query),
        aliases: []
      }
    };
  }

  const matches = await listContacts(query);
  if (matches.length === 1) {
    return { status: "resolved", contact: matches[0] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "not_found", matches: [] };
}

export async function upsertContact({ name, phone, aliases = [] }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error("Phone is required to save a contact");
  }

  const normalizedAliases = [...new Set((aliases || []).filter(Boolean))];

  return withWriteLock("contacts", (contacts) => {
    const existing = contacts.find(
      (contact) => comparablePhone(contact.phone) === comparablePhone(normalizedPhone)
    );

    if (existing) {
      existing.name = name || existing.name;
      existing.aliases = [...new Set([...(existing.aliases || []), ...normalizedAliases])];
      existing.lastSeenAt = nowIso();
      return contacts;
    }

    contacts.push({
      id: crypto.randomUUID(),
      name: name || normalizedPhone,
      phone: normalizedPhone,
      aliases: normalizedAliases,
      createdAt: nowIso(),
      lastSeenAt: nowIso()
    });

    return contacts;
  });
}

export async function appendConversationMessage(chatId, message) {
  return withWriteLock("conversations", (conversations) => {
    const history = conversations[chatId] || [];
    history.push({
      id: message.id || crypto.randomUUID(),
      role: message.role,
      text: message.text,
      at: message.at || nowIso(),
      meta: message.meta || {}
    });
    conversations[chatId] = history.slice(-200);
    return conversations;
  });
}

export async function getConversation(chatId, limit = config.maxConversationMessages) {
  const conversations = await readJson("conversations");
  return (conversations[chatId] || []).slice(-limit);
}

export async function beginInboundProcessing(messageId) {
  const staleBefore = Date.now() - 10 * 60 * 1000;
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

export async function createReminder({ targetPhone, text, dueAt, sourceChatId, createdBy }) {
  const normalizedPhone = normalizePhone(targetPhone);
  if (!normalizedPhone) {
    throw new Error("Reminder target phone is required");
  }

  return withWriteLock("reminders", (reminders) => {
    reminders.push({
      id: crypto.randomUUID(),
      targetPhone: normalizedPhone,
      text,
      dueAt,
      sourceChatId,
      createdBy,
      status: "pending",
      createdAt: nowIso(),
      sentAt: null,
      lastError: null
    });
    return reminders;
  });
}

export async function listReminders(targetPhone = "") {
  const reminders = await readJson("reminders");
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
  return reminders.filter(
    (reminder) =>
      reminder.status === "pending" && new Date(reminder.dueAt).getTime() <= now.getTime()
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
    return reminders;
  });
}

export async function markReminderFailed(reminderId, errorMessage) {
  return withWriteLock("reminders", (reminders) => {
    const reminder = reminders.find((entry) => entry.id === reminderId);
    if (!reminder) {
      return reminders;
    }
    reminder.lastError = errorMessage;
    reminder.lastAttemptAt = nowIso();
    return reminders;
  });
}
