import crypto from "crypto";
import { config } from "./config.js";
import { findBusinessByBillingReference, updateBusinessBillingById } from "./saas-store.js";

function cleanText(value) {
  return String(value || "").trim();
}

function baseUrl(origin = "") {
  return String(config.appBaseUrl || origin || "").replace(/\/$/, "");
}

function razorpayAuth() {
  const credentials = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString("base64");
  return { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" };
}

async function razorpayPost(path, body) {
  const response = await fetch(`https://api.razorpay.com${path}`, {
    method: "POST",
    headers: razorpayAuth(),
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.description || `Razorpay error (${response.status})`);
  }
  return payload;
}

export function hasRazorpayBilling() {
  return Boolean(
    cleanText(config.razorpayKeyId) &&
      cleanText(config.razorpayKeySecret) &&
      cleanText(config.razorpayPlanBasic) &&
      cleanText(config.razorpayPlanPro) &&
      cleanText(config.razorpayPlanPremium)
  );
}

function planIdMap() {
  return {
    basic: cleanText(config.razorpayPlanBasic),
    pro: cleanText(config.razorpayPlanPro),
    premium: cleanText(config.razorpayPlanPremium)
  };
}

export async function createRazorpaySubscription({ business, user, plan, origin = "" }) {
  const normalizedPlan = cleanText(plan || business.plan || "basic").toLowerCase();
  const planId = planIdMap()[normalizedPlan];
  if (!planId) {
    throw new Error(`Missing Razorpay plan id for plan: ${normalizedPlan}`);
  }

  const host = baseUrl(origin);
  if (!host) throw new Error("Missing APP_BASE_URL for Razorpay checkout.");

  const subscription = await razorpayPost("/v1/subscriptions", {
    plan_id: planId,
    total_count: 12,
    quantity: 1,
    customer_notify: 1,
    notes: {
      businessId: business.id,
      userId: user.id,
      plan: normalizedPlan
    }
  });

  await updateBusinessBillingById(business.id, {
    ...business.billing,
    plan: normalizedPlan,
    razorpaySubscriptionId: subscription.id,
    status: "pending",
    lastCheckoutAt: new Date().toISOString()
  });

  return {
    subscriptionId: subscription.id,
    keyId: config.razorpayKeyId,
    businessName: business.name || "Claw Cloud",
    userEmail: user.email,
    userName: user.name || user.email,
    callbackUrl: `${host}/app?tab=billing&billing=success&businessId=${encodeURIComponent(business.id)}`
  };
}

export function verifyRazorpayWebhookSignature(rawBody, signatureHeader) {
  if (!config.razorpayWebhookSecret) return false;
  const expected = crypto
    .createHmac("sha256", config.razorpayWebhookSecret)
    .update(rawBody)
    .digest("hex");
  return expected === signatureHeader;
}

export async function handleRazorpayWebhookEvent(event) {
  const entity = event?.payload?.subscription?.entity || event?.payload?.payment?.entity || {};
  const notes = entity.notes || {};
  const businessId = cleanText(notes.businessId || entity.metadata?.businessId);

  let business = null;
  if (businessId) {
    business = { id: businessId };
  } else {
    business = await findBusinessByBillingReference({
      razorpaySubscriptionId: cleanText(entity.id || entity.subscription_id)
    });
  }

  if (!business?.id) return { ignored: true, reason: "business_not_found" };

  if (event.event === "subscription.activated" || event.event === "subscription.charged") {
    await updateBusinessBillingById(business.id, {
      razorpaySubscriptionId: cleanText(entity.id || entity.subscription_id),
      status: "active",
      plan: cleanText(notes.plan) || "basic",
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  if (event.event === "subscription.cancelled" || event.event === "subscription.completed") {
    await updateBusinessBillingById(business.id, {
      razorpaySubscriptionId: cleanText(entity.id || entity.subscription_id),
      status: "inactive",
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  if (event.event === "subscription.halted" || event.event === "payment.failed") {
    await updateBusinessBillingById(business.id, {
      status: "past_due",
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  return { ignored: true, reason: "unsupported_event" };
}
