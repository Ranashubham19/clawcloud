import { config, requireConfig } from "./config.js";
import {
  findBusinessByBillingReference,
  updateBusinessBillingById
} from "./saas-store.js";

function cleanText(value) {
  return String(value || "").trim();
}

function baseUrl(origin = "") {
  return String(config.appBaseUrl || origin || "").replace(/\/$/, "");
}

function planPriceMap() {
  return {
    basic: cleanText(config.stripePriceBasic),
    pro: cleanText(config.stripePricePro),
    premium: cleanText(config.stripePricePremium)
  };
}

function planFromPriceId(priceId) {
  const found = Object.entries(planPriceMap()).find(([, id]) => id === cleanText(priceId));
  return found?.[0] || "";
}

function stripeAuthHeaders() {
  requireConfig("STRIPE_SECRET_KEY", config.stripeSecretKey);
  return {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
}

function urlEncode(body) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.append(key, String(value));
  }
  return params;
}

async function stripePost(path, body) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: stripeAuthHeaders(),
    body: urlEncode(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed (${response.status}).`);
  }
  return payload;
}

export function hasStripeBilling() {
  return Boolean(
    cleanText(config.stripeSecretKey) &&
      cleanText(config.stripePriceBasic) &&
      cleanText(config.stripePricePro) &&
      cleanText(config.stripePricePremium)
  );
}

async function ensureStripeCustomer({ business, user }) {
  if (business.billing?.stripeCustomerId) {
    return business.billing.stripeCustomerId;
  }

  const customer = await stripePost("/v1/customers", {
    name: business.name,
    email: business.supportEmail || user.email,
    "metadata[businessId]": business.id,
    "metadata[userId]": user.id
  });

  await updateBusinessBillingById(business.id, {
    ...business.billing,
    stripeCustomerId: customer.id,
    status: business.billing?.status || "inactive"
  });

  return customer.id;
}

export async function createStripeCheckoutSession({
  business,
  user,
  plan,
  origin = ""
}) {
  const normalizedPlan = cleanText(plan || business.plan || "basic").toLowerCase();
  const priceId = planPriceMap()[normalizedPlan];
  if (!priceId) {
    throw new Error(`Missing Stripe price id for plan: ${normalizedPlan}`);
  }

  const host = baseUrl(origin);
  if (!host) {
    throw new Error("Missing APP_BASE_URL for Stripe checkout.");
  }

  const customerId = await ensureStripeCustomer({ business, user });
  const successUrl = `${host}/app?tab=billing&billing=success&businessId=${encodeURIComponent(business.id)}`;
  const cancelUrl = `${host}/app?tab=billing&billing=cancel&businessId=${encodeURIComponent(business.id)}`;

  const session = await stripePost("/v1/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    "allow_promotion_codes": true,
    "billing_address_collection": "auto",
    "metadata[businessId]": business.id,
    "metadata[userId]": user.id,
    "metadata[plan]": normalizedPlan,
    "subscription_data[metadata][businessId]": business.id,
    "subscription_data[metadata][plan]": normalizedPlan
  });

  await updateBusinessBillingById(business.id, {
    ...business.billing,
    plan: normalizedPlan,
    stripeCustomerId: customerId,
    stripeCheckoutSessionId: session.id,
    lastCheckoutAt: new Date().toISOString()
  });

  return session;
}

export async function createStripePortalSession({ business, origin = "" }) {
  const host = baseUrl(origin);
  if (!host) {
    throw new Error("Missing APP_BASE_URL for Stripe billing portal.");
  }
  if (!business.billing?.stripeCustomerId) {
    throw new Error("This business has no Stripe customer yet.");
  }

  return stripePost("/v1/billing_portal/sessions", {
    customer: business.billing.stripeCustomerId,
    return_url: `${host}/app?tab=billing&businessId=${encodeURIComponent(business.id)}`
  });
}

function epochToIso(value) {
  const numeric = Number(value);
  if (!numeric) {
    return "";
  }
  return new Date(numeric * 1000).toISOString();
}

async function resolveBillingBusiness(eventObject) {
  const metadataBusinessId = cleanText(eventObject?.metadata?.businessId);
  if (metadataBusinessId) {
    return {
      id: metadataBusinessId
    };
  }

  return findBusinessByBillingReference({
    stripeCustomerId: cleanText(eventObject?.customer),
    stripeSubscriptionId: cleanText(eventObject?.id || eventObject?.subscription)
  });
}

export async function handleStripeWebhookEvent(event) {
  const object = event?.data?.object || {};
  const business = await resolveBillingBusiness(object);
  if (!business?.id) {
    return { ignored: true, reason: "business_not_found" };
  }

  if (event.type === "checkout.session.completed") {
    await updateBusinessBillingById(business.id, {
      stripeCustomerId: cleanText(object.customer),
      stripeSubscriptionId: cleanText(object.subscription),
      stripeCheckoutSessionId: cleanText(object.id),
      status: cleanText(object.payment_status) === "paid" ? "active" : "pending",
      plan: cleanText(object.metadata?.plan) || "basic",
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const itemPriceId =
      object.items?.data?.[0]?.price?.id ||
      object.plan?.id ||
      "";
    const plan = planFromPriceId(itemPriceId) || cleanText(object.metadata?.plan) || "basic";

    await updateBusinessBillingById(business.id, {
      stripeCustomerId: cleanText(object.customer),
      stripeSubscriptionId: cleanText(object.id),
      status: cleanText(object.status) || "inactive",
      plan,
      currentPeriodStart: epochToIso(object.current_period_start),
      currentPeriodEnd: epochToIso(object.current_period_end),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  if (event.type === "invoice.payment_failed") {
    await updateBusinessBillingById(business.id, {
      stripeCustomerId: cleanText(object.customer),
      stripeSubscriptionId: cleanText(object.subscription),
      status: "past_due",
      lastWebhookAt: new Date().toISOString()
    });
    return { ok: true };
  }

  return { ignored: true, reason: "unsupported_event" };
}
