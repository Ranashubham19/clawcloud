import crypto from "node:crypto";
import { config } from "./config.js";
import { comparablePhone, normalizePhone } from "./lib/phones.js";
import { hashText } from "./lib/text.js";
import { createJsonStore } from "./json-store.js";

const defaults = {
  users: [],
  businesses: [],
  leads: [],
  bookings: [],
  sessions: [],
  tokens: [],
  team: [],
  apikeys: [],
  audit: [],
  usage: []
};

const fileNames = {
  users: "saas-users.json",
  businesses: "saas-businesses.json",
  leads: "saas-leads.json",
  bookings: "saas-bookings.json",
  sessions: "saas-sessions.json",
  tokens: "saas-tokens.json",
  team: "saas-team.json",
  apikeys: "saas-apikeys.json",
  audit: "saas-audit.json",
  usage: "saas-usage.json"
};

export const PLAN_LIMITS = {
  basic:   { messagesPerMonth: 500,  leadsMax: 100, businessesMax: 1, teamMax: 1 },
  pro:     { messagesPerMonth: 2000, leadsMax: 500, businessesMax: 3, teamMax: 5 },
  premium: { messagesPerMonth: 99999, leadsMax: 99999, businessesMax: 10, teamMax: 20 }
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const leadStatusOrder = [
  "new",
  "engaged",
  "qualified",
  "demo_requested",
  "demo_booked",
  "won",
  "lost"
];

function cloneDefault(name) {
  return JSON.parse(JSON.stringify(defaults[name]));
}

const jsonStore = createJsonStore({
  namespace: "saas",
  defaults,
  fileNames
});
const ensureFiles = () => jsonStore.ensureFiles();
const readJson = (name) => jsonStore.readJson(name);
const writeJson = (name, data) => jsonStore.writeJson(name, data);
const withWriteLock = (name, updater) => jsonStore.withWriteLock(name, updater);

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueSlug(baseSlug, businesses, currentId = "") {
  const base = baseSlug || "institute";
  let next = base;
  let counter = 2;

  while (
    businesses.some(
      (business) => business.slug === next && String(business.id) !== String(currentId)
    )
  ) {
    next = `${base}-${counter}`;
    counter += 1;
  }

  return next;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || "").split(":");
  if (!salt || !expected) {
    return false;
  }

  const actual = crypto
    .scryptSync(String(password || ""), salt, 64)
    .toString("hex");

  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function maskSecret(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  if (text.length <= 8) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function generateWebhookVerifyToken() {
  return crypto.randomBytes(18).toString("hex");
}

function normalizeFaqItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: cleanText(item.id) || crypto.randomUUID(),
      question: cleanText(item.question),
      answer: cleanText(item.answer)
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 50);
}

function normalizeCourseItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: cleanText(item.id) || crypto.randomUUID(),
      name: cleanText(item.name),
      description: cleanText(item.description),
      fee: cleanText(item.fee),
      timings: (Array.isArray(item.timings) ? item.timings : [])
        .map((entry) => cleanText(entry))
        .filter(Boolean)
        .slice(0, 8),
      keywords: (Array.isArray(item.keywords) ? item.keywords : [])
        .map((entry) => cleanText(entry).toLowerCase())
        .filter(Boolean)
        .slice(0, 16)
    }))
    .filter((item) => item.name)
    .slice(0, 25);
}

function normalizeBranding(branding = {}) {
  return {
    primaryColor: cleanText(branding.primaryColor) || "#0b6bcb",
    accentColor: cleanText(branding.accentColor) || "#15b79e",
    headline: cleanText(branding.headline),
    subheadline: cleanText(branding.subheadline)
  };
}

function normalizeBilling(billing = {}, current = {}) {
  return {
    provider: cleanText(billing.provider) || current.provider || "stripe",
    status: cleanText(billing.status) || current.status || "inactive",
    plan: cleanText(billing.plan) || current.plan || "basic",
    stripeCustomerId:
      cleanText(billing.stripeCustomerId) || current.stripeCustomerId || "",
    stripeSubscriptionId:
      cleanText(billing.stripeSubscriptionId) || current.stripeSubscriptionId || "",
    stripeCheckoutSessionId:
      cleanText(billing.stripeCheckoutSessionId) || current.stripeCheckoutSessionId || "",
    razorpaySubscriptionId:
      cleanText(billing.razorpaySubscriptionId) || current.razorpaySubscriptionId || "",
    currentPeriodStart:
      cleanText(billing.currentPeriodStart) || current.currentPeriodStart || "",
    currentPeriodEnd:
      cleanText(billing.currentPeriodEnd) || current.currentPeriodEnd || "",
    cancelAtPeriodEnd:
      billing.cancelAtPeriodEnd !== undefined
        ? billing.cancelAtPeriodEnd === true
        : current.cancelAtPeriodEnd === true,
    lastCheckoutAt:
      cleanText(billing.lastCheckoutAt) || current.lastCheckoutAt || "",
    lastWebhookAt:
      cleanText(billing.lastWebhookAt) || current.lastWebhookAt || ""
  };
}

function defaultAssistantPrompt(name) {
  return [
    `You are the AI assistant for ${name}.`,
    "Answer user questions clearly, professionally, and naturally.",
    "Behave like a general-purpose question-answering assistant unless the user explicitly asks about the business.",
    "Do not push demos, courses, admissions, or lead-capture flows by default.",
    "Use clean formatting with short paragraphs and simple headings when needed."
  ].join(" ");
}

function leadStatusRank(status) {
  const index = leadStatusOrder.indexOf(cleanText(status).toLowerCase());
  return index === -1 ? 0 : index;
}

function nextLeadStatus(currentStatus, proposedStatus) {
  if (!proposedStatus) {
    return currentStatus || "new";
  }
  return leadStatusRank(proposedStatus) >= leadStatusRank(currentStatus)
    ? proposedStatus
    : currentStatus;
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

export function sanitizeWhatsAppIntegration(whatsapp = {}) {
  const provider = cleanText(whatsapp.provider || config.messagingProvider || "meta").toLowerCase();
  const accessTokenConfigured = Boolean(cleanText(whatsapp.accessToken));
  const directChatUrl = cleanText(whatsapp.directChatUrl);
  const directConnected = provider === "direct" && Boolean(cleanText(whatsapp.connectedAt) || directChatUrl);
  const appSecretConfigured =
    provider === "meta"
      ? Boolean(cleanText(whatsapp.appSecret) || cleanText(config.whatsappAppSecret))
      : false;
  const metaConfigured = Boolean(cleanText(whatsapp.phoneNumberId) && accessTokenConfigured && appSecretConfigured);
  const aisensyConfigured = Boolean(
    cleanText(config.aisensyApiKey) &&
      cleanText(config.aisensyCampaignName) &&
      cleanText(config.aisensyFlowToken)
  );
  const configured =
    provider === "direct"
      ? directConnected
      : provider === "aisensy"
      ? aisensyConfigured
      : metaConfigured;
  const webhookReady = directConnected || Boolean(cleanText(whatsapp.webhookVerifiedAt));
  const botLive =
    provider === "direct"
      ? directConnected
      : provider === "aisensy"
      ? configured
      : Boolean(configured && webhookReady);
  const status = botLive
    ? "live"
    : configured
    ? provider === "meta"
      ? "pending_webhook"
      : "configured"
    : "disconnected";

  return {
    provider,
    displayPhoneNumber: whatsapp.displayPhoneNumber || "",
    phoneNumberId: whatsapp.phoneNumberId || "",
    businessAccountId: whatsapp.businessAccountId || "",
    accessTokenMask: maskSecret(whatsapp.accessToken || ""),
    accessTokenConfigured,
    appSecretMask: maskSecret(whatsapp.appSecret || ""),
    appSecretConfigured,
    webhookUrl: cleanText(whatsapp.webhookUrl),
    webhookVerifyToken: cleanText(whatsapp.webhookVerifyToken),
    directChatUrl,
    connectedAt: cleanText(whatsapp.connectedAt),
    webhookVerifiedAt: cleanText(whatsapp.webhookVerifiedAt),
    lastError: cleanText(whatsapp.lastError),
    directConnected,
    metaConfigured,
    configured,
    webhookReady,
    botLive,
    status,
    canDeactivate: configured || botLive,
    reconnectRequiredAfterDeactivate: true
  };
}

function sanitizeBusiness(business) {
  if (!business) {
    return null;
  }

  return {
    id: business.id,
    userId: business.userId,
    name: business.name,
    slug: business.slug,
    description: business.description,
    supportEmail: business.supportEmail,
    website: business.website,
    branding: business.branding,
    aiPrompt: business.aiPrompt,
    welcomeMessage: business.welcomeMessage,
    faqItems: business.faqItems || [],
    courseItems: business.courseItems || [],
    plan: business.plan,
    status: business.status,
    billing: business.billing || normalizeBilling({}, { plan: business.plan }),
    whatsapp: sanitizeWhatsAppIntegration(business.whatsapp || {}),
    telegram: sanitizeTelegramIntegration(business.telegram),
    settings: business.settings || {},
    createdAt: business.createdAt,
    updatedAt: business.updatedAt
  };
}

export function sanitizeTelegramIntegration(telegram = {}) {
  const tokenConfigured = Boolean(cleanText(telegram.token));
  const webhookReady = Boolean(cleanText(telegram.webhookUrl) && cleanText(telegram.webhookVerifiedAt));
  const configured = Boolean(tokenConfigured && cleanText(telegram.webhookUrl));
  const botLive = Boolean(configured && webhookReady);
  const status = botLive ? "live" : configured ? "pending_webhook" : "disconnected";
  return {
    botUsername: cleanText(telegram.botUsername),
    botName: cleanText(telegram.botName),
    webhookUrl: cleanText(telegram.webhookUrl),
    connectedAt: cleanText(telegram.connectedAt),
    webhookVerifiedAt: cleanText(telegram.webhookVerifiedAt),
    lastError: cleanText(telegram.lastError),
    tokenConfigured,
    configured,
    webhookReady,
    botLive,
    status,
    canDeactivate: configured || botLive,
    reconnectRequiredAfterDeactivate: true
  };
}

function normalizeBusinessPatch(patch = {}, current = {}, businesses = []) {
  const baseName = cleanText(patch.name) || current.name || "New Institute";
  const slug = uniqueSlug(
    slugify(cleanText(patch.slug) || baseName),
    businesses,
    current.id
  );

  const accessToken = Object.prototype.hasOwnProperty.call(
    patch,
    "whatsappAccessToken"
  )
    ? cleanText(patch.whatsappAccessToken)
    : current.whatsapp?.accessToken || "";
  const appSecret = Object.prototype.hasOwnProperty.call(
    patch,
    "whatsappAppSecret"
  )
    ? cleanText(patch.whatsappAppSecret)
    : current.whatsapp?.appSecret || "";

  return {
    name: baseName,
    slug,
    description: cleanText(patch.description) || current.description || "",
    supportEmail:
      normalizeEmail(patch.supportEmail) || current.supportEmail || "",
    website: cleanText(patch.website) || current.website || "",
    branding: normalizeBranding({
      ...(current.branding || {}),
      ...(patch.branding || {})
    }),
    aiPrompt: cleanText(patch.aiPrompt) || current.aiPrompt || defaultAssistantPrompt(baseName),
    welcomeMessage:
      cleanText(patch.welcomeMessage) ||
      current.welcomeMessage ||
      `Hi! Welcome to ${baseName}. I can help with general questions in a clear and professional way.`,
    faqItems: normalizeFaqItems(
      Object.prototype.hasOwnProperty.call(patch, "faqItems")
        ? patch.faqItems
        : current.faqItems || []
    ),
    courseItems: normalizeCourseItems(
      Object.prototype.hasOwnProperty.call(patch, "courseItems")
        ? patch.courseItems
        : current.courseItems || []
    ),
    plan: cleanText(patch.plan) || current.plan || "basic",
    status: cleanText(patch.status) || current.status || "active",
    billing: normalizeBilling(
      patch.billing || {},
      current.billing || { plan: cleanText(patch.plan) || current.plan || "basic" }
    ),
    whatsapp: {
      provider:
        cleanText(patch.whatsappProvider) ||
        current.whatsapp?.provider ||
        config.messagingProvider,
      displayPhoneNumber:
        normalizePhone(patch.whatsappDisplayPhoneNumber) ||
        current.whatsapp?.displayPhoneNumber ||
        "",
      phoneNumberId:
        cleanText(patch.whatsappPhoneNumberId) ||
        current.whatsapp?.phoneNumberId ||
        "",
      businessAccountId:
        cleanText(patch.whatsappBusinessAccountId) ||
        current.whatsapp?.businessAccountId ||
        "",
      accessToken,
      appSecret,
      webhookUrl:
        cleanText(patch.whatsappWebhookUrl) ||
        current.whatsapp?.webhookUrl ||
        "",
      webhookVerifyToken:
        cleanText(patch.whatsappWebhookVerifyToken) ||
        current.whatsapp?.webhookVerifyToken ||
        "",
      connectedAt:
        cleanText(patch.whatsappConnectedAt) ||
        current.whatsapp?.connectedAt ||
        "",
      webhookVerifiedAt:
        cleanText(patch.whatsappWebhookVerifiedAt) ||
        current.whatsapp?.webhookVerifiedAt ||
        "",
      directChatUrl:
        cleanText(patch.whatsappDirectChatUrl) ||
        current.whatsapp?.directChatUrl ||
        "",
      lastError: Object.prototype.hasOwnProperty.call(patch, "whatsappLastError")
        ? cleanText(patch.whatsappLastError)
        : current.whatsapp?.lastError || ""
    },
    settings: {
      autoReplyEnabled:
        patch.autoReplyEnabled !== undefined
          ? patch.autoReplyEnabled !== false
          : current.settings?.autoReplyEnabled !== false,
      leadCaptureEnabled:
        patch.leadCaptureEnabled !== undefined
          ? patch.leadCaptureEnabled !== false
          : current.settings?.leadCaptureEnabled !== false,
      demoBookingEnabled:
        patch.demoBookingEnabled !== undefined
          ? patch.demoBookingEnabled !== false
          : current.settings?.demoBookingEnabled !== false
    }
  };
}

function assertUniqueWhatsAppChannel(businesses, currentId, whatsapp = {}) {
  if (cleanText(whatsapp.provider).toLowerCase() === "direct") {
    return;
  }

  const phoneNumberId = cleanText(whatsapp.phoneNumberId);
  const displayPhone = comparablePhone(whatsapp.displayPhoneNumber || "");

  const conflict = businesses.find((business) => {
    if (String(business.id) === String(currentId || "")) {
      return false;
    }

    return (
      (phoneNumberId && cleanText(business.whatsapp?.phoneNumberId) === phoneNumberId) ||
      (displayPhone &&
        comparablePhone(business.whatsapp?.displayPhoneNumber || "") === displayPhone)
    );
  });

  if (!conflict) {
    return;
  }

  if (phoneNumberId && cleanText(conflict.whatsapp?.phoneNumberId) === phoneNumberId) {
    throw new Error(
      "This WhatsApp Phone Number ID is already connected to another workspace. Disconnect it there first."
    );
  }

  throw new Error(
    "This WhatsApp display number is already connected to another workspace. Disconnect it there first."
  );
}

async function pruneExpiredSessions() {
  return withWriteLock("sessions", (sessions) =>
    sessions.filter((session) => new Date(session.expiresAt || 0).getTime() > Date.now())
  );
}

export async function initSaasStore() {
  await ensureFiles();
  await pruneExpiredSessions();
}

export async function createSaasUser({ name, email, password }) {
  const cleanName = cleanText(name);
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || "");

  if (!cleanName) {
    throw new Error("Name is required.");
  }
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("A valid email is required.");
  }
  if (cleanPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  let created = null;
  await withWriteLock("users", (users) => {
    if (users.some((user) => user.email === cleanEmail)) {
      throw new Error("An account with this email already exists.");
    }

    created = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: cleanEmail,
      passwordHash: hashPassword(cleanPassword),
      createdAt: nowIso()
    };
    users.push(created);
    return users;
  });

  return sanitizeUser(created);
}

export async function findOrCreateGoogleUser({ googleId, email, name }) {
  const cleanEmail = normalizeEmail(email);
  let found = null;

  await withWriteLock("users", (users) => {
    found = users.find((u) => u.googleId === googleId || u.email === cleanEmail);
    if (found) {
      if (!found.googleId) {
        found.googleId = googleId;
      }
      return users;
    }
    found = {
      id: crypto.randomUUID(),
      name: cleanText(name) || cleanEmail,
      email: cleanEmail,
      googleId,
      passwordHash: "",
      createdAt: nowIso()
    };
    users.push(found);
    return users;
  });

  return { user: sanitizeUser(found), isNew: !found.passwordHash && found.googleId === googleId };
}

export async function authenticateSaasUser({ email, password }) {
  const users = await readJson("users");
  const user = users.find((entry) => entry.email === normalizeEmail(email));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }
  return sanitizeUser(user);
}

export async function createSaasSession({ userId, userAgent = "", ipAddress = "" }) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashText(token),
    userAgent: cleanText(userAgent).slice(0, 200),
    ipAddress: cleanText(ipAddress).slice(0, 80),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
  };

  await withWriteLock("sessions", (sessions) => {
    sessions.push(session);
    return sessions;
  });

  return {
    token,
    session
  };
}

export async function getSaasSession(token) {
  const tokenHash = hashText(token);
  const sessions = await readJson("sessions");
  const session = sessions.find((entry) => entry.tokenHash === tokenHash);
  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt || 0).getTime() <= Date.now()) {
    await deleteSaasSession(token);
    return null;
  }

  const users = await readJson("users");
  const user = users.find((entry) => entry.id === session.userId);
  if (!user) {
    return null;
  }

  await withWriteLock("sessions", (currentSessions) =>
    currentSessions.map((entry) =>
      entry.id === session.id
        ? {
            ...entry,
            lastSeenAt: nowIso()
          }
        : entry
    )
  );

  return {
    session,
    user: sanitizeUser(user)
  };
}

export async function deleteSaasSession(token) {
  const tokenHash = hashText(token);
  await withWriteLock("sessions", (sessions) =>
    sessions.filter((entry) => entry.tokenHash !== tokenHash)
  );
}

export async function listBusinessesForUser(userId) {
  const businesses = await readJson("businesses");
  return businesses
    .filter((business) => business.userId === userId)
    .sort(
      (left, right) =>
        new Date(right.updatedAt || 0).getTime() -
        new Date(left.updatedAt || 0).getTime()
    )
    .map(sanitizeBusiness);
}

export async function createBusinessForUser(userId, payload = {}) {
  const businesses = await readJson("businesses");
  const normalized = normalizeBusinessPatch(payload, {}, businesses);
  assertUniqueWhatsAppChannel(businesses, "", normalized.whatsapp);

  const business = {
    id: crypto.randomUUID(),
    userId,
    ...normalized,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await withWriteLock("businesses", (current) => {
    current.push(business);
    return current;
  });

  return sanitizeBusiness(business);
}

export async function getBusinessForUser(userId, businessId) {
  const businesses = await readJson("businesses");
  const business = businesses.find(
    (entry) => entry.id === businessId && entry.userId === userId
  );
  return sanitizeBusiness(business);
}

export async function getRawBusinessById(businessId) {
  const businesses = await readJson("businesses");
  return businesses.find((entry) => entry.id === businessId) || null;
}

export async function updateBusinessBillingById(businessId, billingPatch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex((entry) => entry.id === businessId);
    if (index === -1) {
      throw new Error("Business not found.");
    }

    const current = businesses[index];
    updated = {
      ...current,
      billing: normalizeBilling(billingPatch, current.billing || { plan: current.plan }),
      updatedAt: nowIso()
    };
    businesses[index] = updated;
    return businesses;
  });

  return sanitizeBusiness(updated);
}

export async function getBusinessByInboundChannel({
  businessId = "",
  provider = "",
  phoneNumberId = "",
  displayPhoneNumber = ""
} = {}) {
  const businesses = await readJson("businesses");
  const normalizedDisplay = comparablePhone(displayPhoneNumber || "");
  const normalizedProvider = cleanText(provider).toLowerCase();

  if (cleanText(businessId)) {
    const direct = businesses.find((business) => business.id === cleanText(businessId));
    if (direct) {
      return direct;
    }
  }

  return (
    businesses.find(
      (business) =>
        cleanText(phoneNumberId) &&
        business.whatsapp?.phoneNumberId === cleanText(phoneNumberId)
    ) ||
    businesses.find(
      (business) =>
        normalizedDisplay &&
        cleanText(business.whatsapp?.provider).toLowerCase() !== "direct" &&
        comparablePhone(business.whatsapp?.displayPhoneNumber || "") === normalizedDisplay
    ) ||
    (() => {
      if (!normalizedProvider) {
        return null;
      }
      const matches = businesses.filter(
        (business) =>
          cleanText(business.whatsapp?.provider).toLowerCase() === normalizedProvider
      );
      return matches.length === 1 ? matches[0] : null;
    })() ||
    null
  );
}

export async function findBusinessByBillingReference({
  stripeCustomerId = "",
  stripeSubscriptionId = "",
  razorpaySubscriptionId = ""
} = {}) {
  const businesses = await readJson("businesses");
  return (
    businesses.find(
      (business) =>
        cleanText(stripeCustomerId) &&
        business.billing?.stripeCustomerId === cleanText(stripeCustomerId)
    ) ||
    businesses.find(
      (business) =>
        cleanText(stripeSubscriptionId) &&
        business.billing?.stripeSubscriptionId === cleanText(stripeSubscriptionId)
    ) ||
    businesses.find(
      (business) =>
        cleanText(razorpaySubscriptionId) &&
        business.billing?.razorpaySubscriptionId === cleanText(razorpaySubscriptionId)
    ) ||
    null
  );
}

export async function updateBusinessForUser(userId, businessId, patch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex(
      (entry) => entry.id === businessId && entry.userId === userId
    );
    if (index === -1) {
      throw new Error("Business not found.");
    }

    const current = businesses[index];
    const normalized = normalizeBusinessPatch(patch, current, businesses);
    assertUniqueWhatsAppChannel(businesses, businessId, normalized.whatsapp);
    updated = {
      ...current,
      ...normalized,
      updatedAt: nowIso()
    };
    businesses[index] = updated;
    return businesses;
  });

  return sanitizeBusiness(updated);
}

export async function findBusinessByWhatsAppChannel({
  phoneNumberId = "",
  displayPhoneNumber = "",
  excludeBusinessId = ""
} = {}) {
  const businesses = await readJson("businesses");
  const normalizedPhoneNumberId = cleanText(phoneNumberId);
  const normalizedDisplay = comparablePhone(displayPhoneNumber || "");

  return (
    businesses.find(
      (business) =>
        String(business.id) !== String(excludeBusinessId || "") &&
        normalizedPhoneNumberId &&
        cleanText(business.whatsapp?.phoneNumberId) === normalizedPhoneNumberId
    ) ||
    businesses.find(
      (business) =>
        String(business.id) !== String(excludeBusinessId || "") &&
        normalizedDisplay &&
        comparablePhone(business.whatsapp?.displayPhoneNumber || "") === normalizedDisplay
    ) ||
    null
  );
}

export async function findBusinessByWhatsAppVerifyToken(token) {
  const normalizedToken = cleanText(token);
  if (!normalizedToken) {
    return null;
  }

  const businesses = await readJson("businesses");
  return (
    businesses.find(
      (business) =>
        cleanText(business.whatsapp?.webhookVerifyToken) === normalizedToken
    ) || null
  );
}

export async function getBusinessByTelegramToken(businessId) {
  const businesses = await readJson("businesses");
  return businesses.find((b) => b.id === businessId) || null;
}

export async function findBusinessByTelegramToken(token) {
  const normalizedToken = cleanText(token);
  if (!normalizedToken) {
    return null;
  }

  const businesses = await readJson("businesses");
  return (
    businesses.find(
      (business) => cleanText(business.telegram?.token) === normalizedToken
    ) || null
  );
}

export async function updateBusinessTelegram(userId, businessId, telegramPatch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex(
      (entry) => entry.id === businessId && entry.userId === userId
    );
    if (index === -1) throw new Error("Business not found.");
    updated = {
      ...businesses[index],
      telegram: { ...businesses[index].telegram, ...telegramPatch },
      updatedAt: new Date().toISOString()
    };
    businesses[index] = updated;
    return businesses;
  });
  return updated;
}

export async function updateBusinessTelegramById(businessId, telegramPatch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex((entry) => entry.id === businessId);
    if (index === -1) throw new Error("Business not found.");
    updated = {
      ...businesses[index],
      telegram: { ...businesses[index].telegram, ...telegramPatch },
      updatedAt: new Date().toISOString()
    };
    businesses[index] = updated;
    return businesses;
  });
  return updated;
}

export async function updateBusinessWhatsApp(userId, businessId, whatsappPatch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex(
      (entry) => entry.id === businessId && entry.userId === userId
    );
    if (index === -1) {
      throw new Error("Business not found.");
    }

    const current = businesses[index];
    const merged = {
      ...current,
      whatsapp: {
        ...(current.whatsapp || {}),
        ...whatsappPatch,
        webhookVerifyToken:
          cleanText(whatsappPatch.webhookVerifyToken) ||
          current.whatsapp?.webhookVerifyToken ||
          generateWebhookVerifyToken()
      },
      updatedAt: nowIso()
    };

    assertUniqueWhatsAppChannel(businesses, businessId, merged.whatsapp);
    updated = merged;
    businesses[index] = merged;
    return businesses;
  });

  return sanitizeBusiness(updated);
}

export async function updateBusinessWhatsAppById(businessId, whatsappPatch = {}) {
  let updated = null;
  await withWriteLock("businesses", (businesses) => {
    const index = businesses.findIndex((entry) => entry.id === businessId);
    if (index === -1) {
      throw new Error("Business not found.");
    }

    const current = businesses[index];
    const merged = {
      ...current,
      whatsapp: {
        ...(current.whatsapp || {}),
        ...whatsappPatch,
        webhookVerifyToken:
          cleanText(whatsappPatch.webhookVerifyToken) ||
          current.whatsapp?.webhookVerifyToken ||
          generateWebhookVerifyToken()
      },
      updatedAt: nowIso()
    };

    assertUniqueWhatsAppChannel(businesses, businessId, merged.whatsapp);
    updated = merged;
    businesses[index] = merged;
    return businesses;
  });

  return sanitizeBusiness(updated);
}

export async function listLeadsForBusiness(businessId) {
  const leads = await readJson("leads");
  return leads
    .filter((lead) => lead.businessId === businessId)
    .sort(
      (left, right) =>
        new Date(right.updatedAt || 0).getTime() -
        new Date(left.updatedAt || 0).getTime()
    );
}

export async function getLeadByPhone(businessId, phone) {
  const normalizedPhone = comparablePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const leads = await readJson("leads");
  return (
    leads.find(
      (lead) =>
        lead.businessId === businessId &&
        comparablePhone(lead.phone) === normalizedPhone
    ) || null
  );
}

export async function upsertLeadForBusiness({
  businessId,
  phone,
  name = "",
  courseInterest = "",
  preferredTiming = "",
  source = "whatsapp",
  status = "",
  notes = "",
  lastMessage = "",
  profileName = ""
}) {
  const normalizedPhone = normalizePhone(phone);
  if (!businessId || !normalizedPhone) {
    throw new Error("businessId and phone are required to upsert a lead.");
  }

  let updated = null;
  await withWriteLock("leads", (leads) => {
    const existing = leads.find(
      (lead) =>
        lead.businessId === businessId &&
        comparablePhone(lead.phone) === comparablePhone(normalizedPhone)
    );

    if (existing) {
      existing.name = cleanText(name) || existing.name || cleanText(profileName) || normalizedPhone;
      existing.profileName = cleanText(profileName) || existing.profileName || "";
      existing.courseInterest = cleanText(courseInterest) || existing.courseInterest || "";
      existing.preferredTiming = cleanText(preferredTiming) || existing.preferredTiming || "";
      existing.status = nextLeadStatus(existing.status || "new", cleanText(status).toLowerCase());
      existing.source = cleanText(source) || existing.source || "whatsapp";
      existing.lastMessage = cleanText(lastMessage) || existing.lastMessage || "";
      existing.lastSeenAt = nowIso();
      existing.updatedAt = nowIso();
      if (cleanText(notes)) {
        existing.notes = [...new Set([...(existing.notes || []), cleanText(notes)])];
      }
      updated = existing;
      return leads;
    }

    updated = {
      id: crypto.randomUUID(),
      businessId,
      phone: normalizedPhone,
      name: cleanText(name) || cleanText(profileName) || normalizedPhone,
      profileName: cleanText(profileName),
      courseInterest: cleanText(courseInterest),
      preferredTiming: cleanText(preferredTiming),
      status: cleanText(status).toLowerCase() || "new",
      source: cleanText(source) || "whatsapp",
      notes: cleanText(notes) ? [cleanText(notes)] : [],
      lastMessage: cleanText(lastMessage),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso()
    };
    leads.push(updated);
    return leads;
  });

  return updated;
}

export async function updateLeadForBusiness(businessId, leadId, patch = {}) {
  let updated = null;
  await withWriteLock("leads", (leads) => {
    const lead = leads.find(
      (entry) => entry.id === leadId && entry.businessId === businessId
    );
    if (!lead) {
      throw new Error("Lead not found.");
    }

    lead.name = cleanText(patch.name) || lead.name;
    lead.courseInterest = cleanText(patch.courseInterest) || lead.courseInterest;
    lead.preferredTiming = cleanText(patch.preferredTiming) || lead.preferredTiming;
    lead.status = cleanText(patch.status).toLowerCase() || lead.status;
    if (cleanText(patch.note)) {
      lead.notes = [...new Set([...(lead.notes || []), cleanText(patch.note)])];
    }
    lead.updatedAt = nowIso();
    updated = { ...lead };
    return leads;
  });

  return updated;
}

export async function listBookingsForBusiness(businessId) {
  const bookings = await readJson("bookings");
  return bookings
    .filter((booking) => booking.businessId === businessId)
    .sort(
      (left, right) =>
        new Date(right.updatedAt || 0).getTime() -
        new Date(left.updatedAt || 0).getTime()
    );
}

export async function createBookingForBusiness({
  businessId,
  leadId = "",
  phone,
  name = "",
  courseInterest = "",
  preferredTiming = "",
  status = "requested",
  source = "whatsapp"
}) {
  const normalizedPhone = normalizePhone(phone);
  if (!businessId || !normalizedPhone) {
    throw new Error("businessId and phone are required to create a booking.");
  }

  let created = null;
  await withWriteLock("bookings", (bookings) => {
    const existing = bookings.find(
      (booking) =>
        booking.businessId === businessId &&
        comparablePhone(booking.phone) === comparablePhone(normalizedPhone) &&
        booking.preferredTiming === cleanText(preferredTiming) &&
        booking.status !== "cancelled"
    );

    if (existing) {
      existing.status = cleanText(status) || existing.status;
      existing.updatedAt = nowIso();
      created = existing;
      return bookings;
    }

    created = {
      id: crypto.randomUUID(),
      businessId,
      leadId,
      phone: normalizedPhone,
      name: cleanText(name) || normalizedPhone,
      courseInterest: cleanText(courseInterest),
      preferredTiming: cleanText(preferredTiming),
      status: cleanText(status) || "requested",
      source: cleanText(source) || "whatsapp",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    bookings.push(created);
    return bookings;
  });

  return created;
}

export async function getBusinessAnalyticsSummary(businessId) {
  const [leads, bookings] = await Promise.all([
    listLeadsForBusiness(businessId),
    listBookingsForBusiness(businessId)
  ]);

  return {
    totalLeads: leads.length,
    qualifiedLeads: leads.filter((lead) => leadStatusRank(lead.status) >= leadStatusRank("qualified")).length,
    demoRequested: leads.filter((lead) => lead.status === "demo_requested").length,
    demoBooked: bookings.filter((booking) => booking.status === "confirmed").length,
    recentLeads: leads.slice(0, 5),
    recentBookings: bookings.slice(0, 5)
  };
}

// ─── ADVANCED ANALYTICS ────────────────────────────────────────────────────

export async function getAdvancedAnalytics(businessId) {
  const [leads, bookings] = await Promise.all([
    listLeadsForBusiness(businessId),
    listBookingsForBusiness(businessId)
  ]);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // leads per day last 30 days
  const leadsPerDay = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = now - i * day;
    const dayEnd = dayStart + day;
    const dateStr = new Date(dayStart).toISOString().slice(0, 10);
    leadsPerDay.push({
      date: dateStr,
      count: leads.filter((l) => {
        const t = new Date(l.createdAt || 0).getTime();
        return t >= dayStart && t < dayEnd;
      }).length
    });
  }

  // conversion funnel
  const funnel = [
    { stage: "New", count: leads.filter((l) => l.status === "new").length },
    { stage: "Engaged", count: leads.filter((l) => l.status === "engaged").length },
    { stage: "Qualified", count: leads.filter((l) => l.status === "qualified").length },
    { stage: "Demo Requested", count: leads.filter((l) => l.status === "demo_requested").length },
    { stage: "Demo Booked", count: bookings.filter((b) => b.status === "confirmed").length },
    { stage: "Won", count: leads.filter((l) => l.status === "won").length }
  ];

  const conversionRate = leads.length > 0
    ? Math.round((leads.filter((l) => l.status === "won").length / leads.length) * 100)
    : 0;

  return { leadsPerDay, funnel, conversionRate };
}

// ─── PASSWORD RESET TOKENS ─────────────────────────────────────────────────

export async function createPasswordResetToken(email) {
  const users = await readJson("users");
  const user = users.find((u) => u.email === normalizeEmail(email));
  if (!user) return null;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await withWriteLock("tokens", (tokens) => {
    const filtered = tokens.filter(
      (t) => !(t.userId === user.id && t.type === "password-reset")
    );
    filtered.push({ id: crypto.randomUUID(), userId: user.id, email: user.email, type: "password-reset", token, expiresAt, createdAt: nowIso() });
    return filtered;
  });

  return { token, user: sanitizeUser(user) };
}

export async function consumePasswordResetToken(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const tokens = await readJson("tokens");
  const entry = tokens.find((t) => t.token === token && t.type === "password-reset");
  if (!entry || new Date(entry.expiresAt).getTime() < Date.now()) {
    throw new Error("Reset link is invalid or has expired.");
  }

  await withWriteLock("users", (users) => {
    const user = users.find((u) => u.id === entry.userId);
    if (!user) throw new Error("User not found.");
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = nowIso();
    return users;
  });

  await withWriteLock("tokens", (tokens) =>
    tokens.filter((t) => t.token !== token)
  );

  return true;
}

// ─── TEAM MANAGEMENT ──────────────────────────────────────────────────────

export async function inviteTeamMember({ businessId, invitedByUserId, email, role = "member" }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Valid email required.");

  const validRoles = ["admin", "member", "viewer"];
  const cleanRole = validRoles.includes(role) ? role : "member";

  let created = null;
  await withWriteLock("team", (team) => {
    const existing = team.find((m) => m.businessId === businessId && m.email === cleanEmail);
    if (existing) throw new Error("This email is already a team member.");

    created = {
      id: crypto.randomUUID(),
      businessId,
      invitedByUserId,
      email: cleanEmail,
      role: cleanRole,
      status: "invited",
      inviteToken: crypto.randomBytes(16).toString("hex"),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    team.push(created);
    return team;
  });

  return created;
}

export async function listTeamMembers(businessId) {
  const team = await readJson("team");
  return team.filter((m) => m.businessId === businessId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function removeTeamMember(businessId, memberId) {
  await withWriteLock("team", (team) =>
    team.filter((m) => !(m.id === memberId && m.businessId === businessId))
  );
  return true;
}

export async function acceptTeamInvite(inviteToken) {
  let member = null;
  await withWriteLock("team", (team) => {
    const entry = team.find((m) => m.inviteToken === inviteToken && m.status === "invited");
    if (!entry) throw new Error("Invalid or expired invite.");
    entry.status = "active";
    entry.acceptedAt = nowIso();
    entry.updatedAt = nowIso();
    member = { ...entry };
    return team;
  });
  return member;
}

// ─── API KEY MANAGEMENT ────────────────────────────────────────────────────

export async function createApiKey({ businessId, userId, label = "Default" }) {
  const key = `sk_${crypto.randomBytes(24).toString("hex")}`;
  let created = null;
  await withWriteLock("apikeys", (keys) => {
    created = {
      id: crypto.randomUUID(),
      businessId,
      userId,
      label: String(label || "Default").slice(0, 60),
      keyHash: hashText(key),
      keyPreview: `sk_...${key.slice(-8)}`,
      createdAt: nowIso(),
      lastUsedAt: ""
    };
    keys.push(created);
    return keys;
  });
  return { ...created, key };
}

export async function listApiKeys(businessId) {
  const keys = await readJson("apikeys");
  return keys
    .filter((k) => k.businessId === businessId)
    .map(({ keyHash, ...rest }) => rest)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function revokeApiKey(businessId, keyId) {
  await withWriteLock("apikeys", (keys) =>
    keys.filter((k) => !(k.id === keyId && k.businessId === businessId))
  );
  return true;
}

export async function validateApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith("sk_")) return null;
  const keyHash = hashText(rawKey);
  const keys = await readJson("apikeys");
  const entry = keys.find((k) => k.keyHash === keyHash);
  if (!entry) return null;

  await withWriteLock("apikeys", (keys) =>
    keys.map((k) => k.id === entry.id ? { ...k, lastUsedAt: nowIso() } : k)
  );
  return entry;
}

// ─── AUDIT LOGS ────────────────────────────────────────────────────────────

export async function appendAuditLog({ businessId = "", userId = "", action = "", details = {} }) {
  await withWriteLock("audit", (logs) => {
    logs.push({
      id: crypto.randomUUID(),
      businessId,
      userId,
      action: String(action).slice(0, 100),
      details,
      createdAt: nowIso()
    });
    if (logs.length > 5000) logs.splice(0, logs.length - 5000);
    return logs;
  });
}

export async function listAuditLogs(businessId, limit = 50) {
  const logs = await readJson("audit");
  return logs
    .filter((l) => l.businessId === businessId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.min(limit, 200));
}

// ─── USAGE TRACKING ────────────────────────────────────────────────────────

export async function trackUsage(businessId, type = "message") {
  const monthKey = new Date().toISOString().slice(0, 7);
  await withWriteLock("usage", (usage) => {
    let entry = usage.find((u) => u.businessId === businessId && u.monthKey === monthKey);
    if (!entry) {
      entry = { id: crypto.randomUUID(), businessId, monthKey, messages: 0, leads: 0 };
      usage.push(entry);
    }
    if (type === "message") entry.messages = (entry.messages || 0) + 1;
    if (type === "lead") entry.leads = (entry.leads || 0) + 1;
    return usage;
  });
}

export async function getUsageForBusiness(businessId) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const usage = await readJson("usage");
  const current = usage.find((u) => u.businessId === businessId && u.monthKey === monthKey);
  return { monthKey, messages: current?.messages || 0, leads: current?.leads || 0 };
}

export async function checkPlanLimit(businessId, plan, type) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.basic;
  const usage = await getUsageForBusiness(businessId);
  if (type === "message") return usage.messages < limits.messagesPerMonth;
  if (type === "lead") return usage.leads < limits.leadsMax;
  return true;
}

// ─── ADMIN FUNCTIONS ───────────────────────────────────────────────────────

export async function isAdminUser(userId) {
  const users = await readJson("users");
  const user = users.find((u) => u.id === userId);
  return user?.isAdmin === true;
}

export async function setAdminUser(email, isAdmin = true) {
  await withWriteLock("users", (users) => {
    const user = users.find((u) => u.email === normalizeEmail(email));
    if (!user) throw new Error("User not found.");
    user.isAdmin = isAdmin;
    user.updatedAt = nowIso();
    return users;
  });
}

export async function getAdminStats() {
  const [users, businesses, leads, bookings] = await Promise.all([
    readJson("users"),
    readJson("businesses"),
    readJson("leads"),
    readJson("bookings")
  ]);

  const now = Date.now();
  const day7 = now - 7 * 24 * 60 * 60 * 1000;
  const day30 = now - 30 * 24 * 60 * 60 * 1000;

  return {
    totalUsers: users.length,
    newUsersLast7Days: users.filter((u) => new Date(u.createdAt || 0).getTime() > day7).length,
    totalBusinesses: businesses.length,
    activeBusinesses: businesses.filter((b) => b.status === "active").length,
    totalLeads: leads.length,
    leadsLast30Days: leads.filter((l) => new Date(l.createdAt || 0).getTime() > day30).length,
    totalBookings: bookings.length,
    planBreakdown: {
      basic: businesses.filter((b) => (b.plan || "basic") === "basic").length,
      pro: businesses.filter((b) => b.plan === "pro").length,
      premium: businesses.filter((b) => b.plan === "premium").length
    }
  };
}

export async function adminListAllUsers() {
  const users = await readJson("users");
  return users.map(sanitizeUser).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

export async function adminListAllBusinesses() {
  const businesses = await readJson("businesses");
  return businesses.map(sanitizeBusiness).sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
}

export async function adminSuspendBusiness(businessId, suspended = true) {
  await withWriteLock("businesses", (businesses) => {
    const b = businesses.find((entry) => entry.id === businessId);
    if (!b) throw new Error("Business not found.");
    b.status = suspended ? "suspended" : "active";
    b.updatedAt = nowIso();
    return businesses;
  });
}
