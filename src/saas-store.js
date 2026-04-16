import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { comparablePhone, normalizePhone } from "./lib/phones.js";
import { hashText } from "./lib/text.js";

const defaults = {
  users: [],
  businesses: [],
  leads: [],
  bookings: [],
  sessions: []
};

const fileNames = {
  users: "saas-users.json",
  businesses: "saas-businesses.json",
  leads: "saas-leads.json",
  bookings: "saas-bookings.json",
  sessions: "saas-sessions.json"
};

const writeQueues = new Map();
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
    `You are the admissions assistant for ${name}.`,
    "Only answer using the institute details, course information, FAQs, and business context provided to you.",
    "Your goals are to answer student questions, collect lead details, and move the conversation toward a demo booking.",
    "Always try to capture the student's name, course interest, and preferred timing.",
    "If the message is unrelated to the institute, politely redirect the user back to admissions help."
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

function sanitizeBusiness(business) {
  if (!business) {
    return null;
  }

  const provider = business.whatsapp?.provider || config.messagingProvider;

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
    whatsapp: {
      provider,
      displayPhoneNumber: business.whatsapp?.displayPhoneNumber || "",
      phoneNumberId: business.whatsapp?.phoneNumberId || "",
      businessAccountId: business.whatsapp?.businessAccountId || "",
      accessToken: business.whatsapp?.accessToken || "",
      accessTokenMask: maskSecret(business.whatsapp?.accessToken || ""),
      configured:
        provider === "aisensy"
          ? Boolean(
              cleanText(config.aisensyApiKey) &&
                cleanText(config.aisensyCampaignName) &&
                cleanText(config.aisensyFlowToken)
            )
          : Boolean(business.whatsapp?.accessToken && business.whatsapp?.phoneNumberId)
    },
    settings: business.settings || {},
    createdAt: business.createdAt,
    updatedAt: business.updatedAt
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
      `Hi! Welcome to ${baseName}. I can help with courses, batches, demo classes, and admissions.`,
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
      accessToken
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
  stripeSubscriptionId = ""
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
