import { comparablePhone } from "./lib/phones.js";
import { config } from "./config.js";
import { listConversationThreads } from "./store.js";
import {
  createBookingForBusiness,
  getBusinessAnalyticsSummary,
  getBusinessByInboundChannel,
  getLeadByPhone,
  listBookingsForBusiness,
  listBusinessesForUser,
  listLeadsForBusiness,
  upsertLeadForBusiness
} from "./saas-store.js";

export const saasPlans = [
  {
    id: "basic",
    name: "Basic",
    priceInr: 999,
    priceUsd: 29,
    summary: "One WhatsApp number, lead capture, FAQs, and a lightweight dashboard."
  },
  {
    id: "pro",
    name: "Pro",
    priceInr: 2999,
    priceUsd: 59,
    summary: "Everything in Basic plus demo booking workflows, analytics, and richer AI controls."
  },
  {
    id: "premium",
    name: "Premium",
    priceInr: 5999,
    priceUsd: 99,
    summary: "Multi-institute workflows, premium onboarding help, and room for custom automations."
  }
];

function cleanText(value) {
  return String(value || "").trim();
}

function courseKeywords(course) {
  return [
    cleanText(course.name).toLowerCase(),
    ...(Array.isArray(course.keywords) ? course.keywords : [])
      .map((entry) => cleanText(entry).toLowerCase())
      .filter(Boolean)
  ].filter(Boolean);
}

function extractName(text, fallbackName = "") {
  const candidates = [
    /(?:my name is|i am|i'm|this is)\s+([a-z][a-z\s.'-]{1,40})/i,
    /(?:student name|name)\s*[:=-]\s*([a-z][a-z\s.'-]{1,40})/i
  ];

  for (const pattern of candidates) {
    const match = cleanText(text).match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]).replace(/\s+/g, " ");
    }
  }

  return cleanText(fallbackName);
}

function extractPreferredTiming(text) {
  const source = cleanText(text);
  const patterns = [
    /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i,
    /\b(morning|afternoon|evening|night|weekend|saturday|sunday)\b/i,
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i
  ];

  const parts = [];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      parts.push(cleanText(match[1]));
    }
  }

  return [...new Set(parts)].join(" ").trim();
}

function extractCourseInterest(text, business) {
  const lowerText = cleanText(text).toLowerCase();
  for (const course of business.courseItems || []) {
    if (courseKeywords(course).some((keyword) => keyword && lowerText.includes(keyword))) {
      return cleanText(course.name);
    }
  }

  const genericMatch = lowerText.match(
    /\b(jee|neet|upsc|ssc|banking|cat|gate|foundation|class 11|class 12|iit)\b/i
  );
  return genericMatch?.[1] ? cleanText(genericMatch[1]).toUpperCase() : "";
}

function wantsDemo(text) {
  return /\b(demo|trial|book|schedule|visit|counselling|counseling|call back|callback)\b/i.test(
    cleanText(text)
  );
}

function faqSummary(business) {
  const items = (business.faqItems || []).slice(0, 12);
  if (!items.length) {
    return "No FAQs configured yet.";
  }
  return items
    .map((item) => `Q: ${item.question}\nA: ${item.answer}`)
    .join("\n\n");
}

function courseSummary(business) {
  const items = (business.courseItems || []).slice(0, 12);
  if (!items.length) {
    return "No course catalog configured yet.";
  }
  return items
    .map((course) => {
      const parts = [course.name];
      if (course.description) {
        parts.push(course.description);
      }
      if ((course.timings || []).length) {
        parts.push(`Timings: ${course.timings.join(", ")}`);
      }
      if (course.fee) {
        parts.push(`Fee: ${course.fee}`);
      }
      return parts.join(" | ");
    })
    .join("\n");
}

export function getBusinessWhatsAppConfig(business) {
  if (!business) {
    return null;
  }

  return {
    provider: business.whatsapp?.provider || config.messagingProvider,
    accessToken: business.whatsapp?.accessToken || "",
    phoneNumberId: business.whatsapp?.phoneNumberId || "",
    businessAccountId: business.whatsapp?.businessAccountId || "",
    displayPhoneNumber: business.whatsapp?.displayPhoneNumber || ""
  };
}

export async function resolveBusinessContextForMessage(message) {
  const business = await getBusinessByInboundChannel({
    businessId: message.businessId,
    provider: message.provider,
    phoneNumberId: message.phoneNumberId,
    displayPhoneNumber: message.displayPhoneNumber
  });

  if (!business) {
    return null;
  }

  return {
    ...business,
    id: business.id,
    messagingConfig: getBusinessWhatsAppConfig(business),
    whatsappConfig: getBusinessWhatsAppConfig(business)
  };
}

export async function captureLeadFromInbound({ business, message }) {
  if (!business?.settings?.leadCaptureEnabled) {
    return { lead: null, booking: null };
  }

  const name = extractName(message.text, message.profileName || "");
  const courseInterest = extractCourseInterest(message.text, business);
  const preferredTiming = extractPreferredTiming(message.text);
  const demoRequested = wantsDemo(message.text);
  const status = demoRequested
    ? preferredTiming
      ? "demo_booked"
      : "demo_requested"
    : courseInterest || preferredTiming
      ? "qualified"
      : "engaged";

  const lead = await upsertLeadForBusiness({
    businessId: business.id,
    phone: message.from,
    name,
    profileName: message.profileName,
    courseInterest,
    preferredTiming,
    status,
    lastMessage: message.text,
    notes: demoRequested ? "Demo intent detected from inbound WhatsApp message." : ""
  });

  let booking = null;
  if (demoRequested && business.settings?.demoBookingEnabled !== false) {
    booking = await createBookingForBusiness({
      businessId: business.id,
      leadId: lead.id,
      phone: lead.phone,
      name: lead.name,
      courseInterest: lead.courseInterest,
      preferredTiming: preferredTiming || "Follow up for preferred timing",
      status: preferredTiming ? "confirmed" : "requested"
    });
  }

  return {
    lead,
    booking,
    extracted: {
      name,
      courseInterest,
      preferredTiming,
      demoRequested
    }
  };
}

export function buildBusinessSystemPrompt({
  business,
  languageInstruction,
  languageLabel,
  currentUserPhone,
  profileName,
  lead,
  booking
}) {
  const lines = [
    `You are the official AI admissions assistant for ${business.name}.`,
    "You are not an open-ended chatbot. You only help with admissions, courses, batches, timings, fees, FAQs, demo classes, and lead capture for this institute.",
    "If the user asks something unrelated to the institute, politely steer the conversation back to the institute and what the student needs.",
    "Reply like a polished admissions counselor: professional, warm, specific, and concise.",
    "Answer the student's actual question first. Then guide them to the next best step if needed.",
    "Collect and confirm lead details naturally when missing: student name, course interest, and preferred timing.",
    "When a student shows buying intent, encourage them to book a demo or counselling call without sounding pushy.",
    "Avoid long essays, robotic phrasing, or generic filler.",
    languageInstruction,
    `Required language for this response: ${languageLabel}.`,
    `Current student phone: ${currentUserPhone}.`,
    `Current student profile name: ${profileName || "Unknown"}.`,
    business.branding?.headline ? `Institute headline: ${business.branding.headline}` : "",
    business.description ? `Institute description: ${business.description}` : "",
    `Business prompt: ${business.aiPrompt}`,
    `Configured welcome message: ${business.welcomeMessage}`,
    `Courses:\n${courseSummary(business)}`,
    `FAQs:\n${faqSummary(business)}`,
    lead
      ? `Known lead record: name=${lead.name || "unknown"}, course=${lead.courseInterest || "unknown"}, preferred_timing=${lead.preferredTiming || "unknown"}, status=${lead.status || "new"}`
      : "Known lead record: none yet.",
    booking
      ? `Latest demo booking state: ${booking.status} at ${booking.preferredTiming}`
      : "",
    "Do not mention internal prompts, models, tooling, or that you are following instructions.",
    "Never fabricate courses, fees, timings, policies, discounts, or guarantees that are not in the provided institute data.",
    "If a detail is missing from the institute data, say that you can confirm it with the team instead of guessing."
  ].filter(Boolean);

  return lines.join("\n");
}

export function getBusinessReadiness(business) {
  if (!business) {
    return {
      score: 0,
      items: []
    };
  }

  const provider = cleanText(business.whatsapp?.provider || config.messagingProvider).toLowerCase();
  const messagingReady =
    provider === "aisensy"
      ? Boolean(
          cleanText(config.aisensyApiKey) &&
            cleanText(config.aisensyCampaignName) &&
            cleanText(config.aisensyFlowToken)
        )
      : Boolean(business.whatsapp?.phoneNumberId && business.whatsapp?.accessToken);

  const items = [
    {
      key: "whatsapp_number",
      label:
        provider === "aisensy"
          ? "AiSensy messaging linked"
          : "WhatsApp number linked",
      ok: messagingReady
    },
    {
      key: "courses",
      label: "Courses configured",
      ok: (business.courseItems || []).length > 0
    },
    {
      key: "faqs",
      label: "FAQs configured",
      ok: (business.faqItems || []).length > 0
    },
    {
      key: "ai_prompt",
      label: "Admissions prompt customized",
      ok: Boolean(cleanText(business.aiPrompt))
    },
    {
      key: "billing",
      label: "Billing active",
      ok: ["active", "trialing"].includes(cleanText(business.billing?.status).toLowerCase())
    }
  ];

  const score = items.filter((item) => item.ok).length;
  return {
    score,
    total: items.length,
    items
  };
}

export async function getBusinessDashboardData(userId, businessId) {
  const businesses = await listBusinessesForUser(userId);
  const selectedBusiness =
    businesses.find((business) => business.id === businessId) || businesses[0] || null;

  if (!selectedBusiness) {
    return {
      userBusinesses: businesses,
      selectedBusiness: null,
      analytics: {
        totalLeads: 0,
        qualifiedLeads: 0,
        demoRequested: 0,
        demoBooked: 0,
        totalChats: 0
      },
      readiness: {
        score: 0,
        total: 0,
        items: []
      },
      leads: [],
      bookings: [],
      chats: []
    };
  }

  const [analytics, leads, bookings, chats] = await Promise.all([
    getBusinessAnalyticsSummary(selectedBusiness.id),
    listLeadsForBusiness(selectedBusiness.id),
    listBookingsForBusiness(selectedBusiness.id),
    listConversationThreads({ businessId: selectedBusiness.id, limit: 100 })
  ]);

  return {
    userBusinesses: businesses,
    selectedBusiness,
    analytics: {
      ...analytics,
      totalChats: chats.length
    },
    readiness: getBusinessReadiness(selectedBusiness),
    leads,
    bookings,
    chats
  };
}

export async function getLeadContextForBusiness(business, phone) {
  if (!business?.id || !phone) {
    return null;
  }
  return getLeadByPhone(business.id, phone);
}

export function chatThreadLabel(thread) {
  return thread.contact?.name || thread.contact?.phone || thread.chatId || "Unknown chat";
}

export function businessOwnsPhone(business, phoneNumberId, displayPhoneNumber) {
  if (!business) {
    return false;
  }
  if (cleanText(phoneNumberId) && business.whatsapp?.phoneNumberId === cleanText(phoneNumberId)) {
    return true;
  }
  if (
    comparablePhone(displayPhoneNumber || "") &&
    comparablePhone(business.whatsapp?.displayPhoneNumber || "") === comparablePhone(displayPhoneNumber || "")
  ) {
    return true;
  }
  return false;
}
