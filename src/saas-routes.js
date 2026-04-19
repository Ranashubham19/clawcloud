import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { createStripeCheckoutSession, createStripePortalSession, hasStripeBilling } from "./billing.js";
import { createRazorpaySubscription, hasRazorpayBilling } from "./razorpay-billing.js";
import { getConversation, listConversationThreads } from "./store.js";
import {
  authenticateSaasUser,
  createBookingForBusiness,
  createBusinessForUser,
  createSaasSession,
  createSaasUser,
  deleteSaasSession,
  findOrCreateGoogleUser,
  getBusinessForUser,
  getSaasSession,
  listBusinessesForUser,
  listBookingsForBusiness,
  listLeadsForBusiness,
  updateBusinessForUser,
  updateLeadForBusiness,
  createPasswordResetToken,
  consumePasswordResetToken,
  inviteTeamMember,
  listTeamMembers,
  removeTeamMember,
  acceptTeamInvite,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  appendAuditLog,
  listAuditLogs,
  getUsageForBusiness,
  PLAN_LIMITS,
  isAdminUser,
  getAdminStats,
  adminListAllUsers,
  adminListAllBusinesses,
  adminSuspendBusiness,
  getAdvancedAnalytics,
  updateBusinessWhatsApp,
  updateBusinessTelegram,
  getRawBusinessById,
  findBusinessByTelegramToken
} from "./saas-store.js";
import { getBusinessDashboardData, saasPlans } from "./saas.js";
import {
  setTelegramWebhook,
  getTelegramBotInfo,
  getTelegramWebhookInfo,
  deleteTelegramWebhook
} from "./telegram.js";
import { getWhatsAppPhoneNumberInfo } from "./whatsapp.js";
import { sendWelcomeEmail, sendPasswordResetEmail, sendTeamInviteEmail } from "./mailer.js";
import {
  authRateLimit,
  defaultSecurityHeaders,
  getClientIp,
  hasTrustedOrigin,
  isSecureRequest,
  requestOrigin,
  writeRateLimit
} from "./security.js";

const SESSION_COOKIE_NAME = "swift_saas_session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function publicFilePath(name) {
  return path.resolve(process.cwd(), "public", name);
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function securityHeaders(extra = {}) {
  return {
    ...defaultSecurityHeaders(),
    ...extra
  };
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(
    statusCode,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    })
  );
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendFile(response, statusCode, contentType, body) {
  response.writeHead(
    statusCode,
    securityHeaders({
      "Content-Type": contentType
    })
  );
  response.end(body);
}

async function readJsonBody(request, readRawBody) {
  const raw = await readRawBody(request);
  if (!raw.length) {
    return {};
  }

  return JSON.parse(raw.toString("utf8"));
}

async function sessionContextFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const session = await getSaasSession(token);
  if (!session) {
    return null;
  }

  return {
    token,
    user: session.user,
    session: session.session
  };
}

function sessionCookie(request, token) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure}`;
}

function clearedSessionCookie(request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function routeParts(pathname) {
  return pathname.split("/").filter(Boolean);
}

function rejectIfUntrustedOrigin(request, response) {
  if (!MUTATING_METHODS.has(request.method)) {
    return false;
  }
  if (hasTrustedOrigin(request)) {
    return false;
  }
  sendJson(response, 403, { error: "Blocked by origin policy." });
  return true;
}

function rejectIfRateLimited(request, response, kind) {
  const verdict =
    kind === "auth"
      ? authRateLimit(request)
      : writeRateLimit(request, kind);

  if (verdict.ok) {
    return false;
  }

  sendJson(response, 429, {
    error: "Too many requests. Please slow down and try again."
  });
  return true;
}

async function serveStaticApp(pathname, response) {
  const map = {
    "/": {
      file: "index.html",
      type: "text/html; charset=utf-8",
      encoding: "utf8"
    },
    "/app": {
      file: "index.html",
      type: "text/html; charset=utf-8",
      encoding: "utf8"
    },
    "/app.js": {
      file: "app.js",
      type: "text/javascript; charset=utf-8",
      encoding: "utf8"
    },
    "/app.css": {
      file: "app.css",
      type: "text/css; charset=utf-8",
      encoding: "utf8"
    },
    "/logo.svg": {
      file: "logo.svg",
      type: "image/svg+xml",
      encoding: "utf8"
    },
    "/favicon.ico": { file: "favicon.ico", type: "image/x-icon" },
    "/favicon.svg": {
      file: "favicon.svg",
      type: "image/svg+xml",
      encoding: "utf8"
    },
    "/favicon.png": { file: "favicon.png", type: "image/png" }
  };

  const target = map[pathname];
  if (!target) {
    return false;
  }

  const content = target.encoding
    ? await readFile(publicFilePath(target.file), target.encoding)
    : await readFile(publicFilePath(target.file));
  sendFile(response, 200, target.type, content);
  return true;
}

function billingSummary(business) {
  return {
    enabled: hasStripeBilling(),
    provider: business.billing?.provider || "stripe",
    status: business.billing?.status || "inactive",
    plan: business.billing?.plan || business.plan || "basic",
    stripeCustomerId: business.billing?.stripeCustomerId || "",
    stripeSubscriptionId: business.billing?.stripeSubscriptionId || "",
    currentPeriodStart: business.billing?.currentPeriodStart || "",
    currentPeriodEnd: business.billing?.currentPeriodEnd || "",
    cancelAtPeriodEnd: business.billing?.cancelAtPeriodEnd === true
  };
}

export async function handleSaasRoute({ request, response, url, readRawBody }) {
  if (request.method === "GET" && (await serveStaticApp(url.pathname, response))) {
    return true;
  }

  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  if (rejectIfUntrustedOrigin(request, response)) {
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/plans") {
    sendJson(response, 200, { plans: saasPlans, billingEnabled: hasStripeBilling() || hasRazorpayBilling() });
    return true;
  }

  // ── Password Reset ──────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    if (rejectIfRateLimited(request, response, "auth")) return true;
    try {
      const body = await readJsonBody(request, readRawBody);
      const result = await createPasswordResetToken(body.email || "");
      if (result) {
        sendPasswordResetEmail({ email: result.user.email, resetToken: result.token, appBaseUrl: requestOrigin(request) }).catch(() => {});
      }
      sendJson(response, 200, {
        ok: true,
        message: "If this email exists, a reset link has been sent.",
        ...(result ? { resetToken: result.token } : {})
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
    if (rejectIfRateLimited(request, response, "auth")) return true;
    try {
      const body = await readJsonBody(request, readRawBody);
      await consumePasswordResetToken(body.token || "", body.password || "");
      sendJson(response, 200, { ok: true, message: "Password updated successfully." });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/signup") {
    if (rejectIfRateLimited(request, response, "auth")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const user = await createSaasUser({
        name: body.name,
        email: body.email,
        password: body.password
      });
      const business = await createBusinessForUser(user.id, {
        name: body.businessName || `${user.name} Institute`
      });
      const session = await createSaasSession({
        userId: user.id,
        userAgent: request.headers["user-agent"] || "",
        ipAddress: getClientIp(request)
      });

      sendWelcomeEmail({ name: user.name, email: user.email }).catch(() => {});
      sendJson(
        response,
        201,
        {
          ok: true,
          user,
          business
        },
        {
          "Set-Cookie": sessionCookie(request, session.token)
        }
      );
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (rejectIfRateLimited(request, response, "auth")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const user = await authenticateSaasUser({
        email: body.email,
        password: body.password
      });
      if (!user) {
        sendJson(response, 401, { error: "Invalid email or password." });
        return true;
      }

      const session = await createSaasSession({
        userId: user.id,
        userAgent: request.headers["user-agent"] || "",
        ipAddress: getClientIp(request)
      });

      await appendAuditLog({ userId: user.id, action: "auth.login", details: { ip: getClientIp(request) } });
      sendJson(
        response,
        200,
        { ok: true, user },
        { "Set-Cookie": sessionCookie(request, session.token) }
      );
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = await sessionContextFromRequest(request);
    if (auth?.token) {
      await deleteSaasSession(auth.token);
    }
    sendJson(
      response,
      200,
      { ok: true },
      { "Set-Cookie": clearedSessionCookie(request) }
    );
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/google") {
    const { googleClientId, googleClientSecret, appBaseUrl } = await import("./config.js").then(m => m.config);
    if (!googleClientId || !googleClientSecret) {
      sendJson(response, 503, { error: "Google OAuth not configured." });
      return true;
    }
    const redirectUri = `${appBaseUrl}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account"
    });
    response.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    response.end();
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
    const { googleClientId, googleClientSecret, appBaseUrl } = await import("./config.js").then(m => m.config);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      response.writeHead(302, { Location: `${appBaseUrl}/app?error=google_auth_failed` });
      response.end();
      return true;
    }

    try {
      const redirectUri = `${appBaseUrl}/api/auth/google/callback`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });

      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error("No access token from Google");

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await profileRes.json();
      if (!profile.email) throw new Error("No email from Google");

      const { user, isNew } = await findOrCreateGoogleUser({
        googleId: profile.id,
        email: profile.email,
        name: profile.name || profile.email
      });

      if (isNew) {
        await createBusinessForUser(user.id, { name: `${user.name}'s Business` });
        sendWelcomeEmail({ name: user.name, email: user.email }).catch(() => {});
      }

      const session = await createSaasSession({
        userId: user.id,
        userAgent: request.headers["user-agent"] || "",
        ipAddress: getClientIp(request)
      });

      await appendAuditLog({ userId: user.id, action: "auth.google_login", details: { ip: getClientIp(request) } });

      response.writeHead(302, {
        Location: `${appBaseUrl}/app`,
        "Set-Cookie": sessionCookie(request, session.token)
      });
      response.end();
    } catch (err) {
      console.error("[google-oauth]", err.message);
      response.writeHead(302, { Location: `${appBaseUrl}/app?error=google_auth_failed` });
      response.end();
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const auth = await sessionContextFromRequest(request);
    if (!auth) {
      sendJson(response, 200, { authenticated: false, user: null, businesses: [] });
      return true;
    }

    const businesses = await listBusinessesForUser(auth.user.id);
    sendJson(response, 200, {
      authenticated: true,
      user: auth.user,
      businesses
    });
    return true;
  }

  const auth = await sessionContextFromRequest(request);
  if (!auth) {
    sendJson(response, 401, { error: "Authentication required." });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/app/bootstrap") {
    const payload = await getBusinessDashboardData(
      auth.user.id,
      url.searchParams.get("businessId") || ""
    );
    sendJson(response, 200, {
      ok: true,
      user: auth.user,
      plans: saasPlans,
      billingEnabled: hasStripeBilling() || hasRazorpayBilling(),
      ...payload
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/businesses") {
    const businesses = await listBusinessesForUser(auth.user.id);
    sendJson(response, 200, { businesses, billingEnabled: hasStripeBilling() || hasRazorpayBilling() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/businesses") {
    if (rejectIfRateLimited(request, response, "business-create")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const business = await createBusinessForUser(auth.user.id, body);
      sendJson(response, 201, { ok: true, business });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  const parts = routeParts(url.pathname);
  if (parts[0] !== "api" || parts[1] !== "businesses" || !parts[2]) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const businessId = parts[2];
  const business = await getBusinessForUser(auth.user.id, businessId);
  if (!business) {
    sendJson(response, 404, { error: "Business not found." });
    return true;
  }

  if (parts.length === 3 && request.method === "GET") {
    sendJson(response, 200, { business, billing: billingSummary(business) });
    return true;
  }

  if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
    if (rejectIfRateLimited(request, response, "business-update")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const updated = await updateBusinessForUser(auth.user.id, businessId, body);
      sendJson(response, 200, { ok: true, business: updated });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "dashboard" && request.method === "GET") {
    const payload = await getBusinessDashboardData(auth.user.id, businessId);
    sendJson(response, 200, { ok: true, billingEnabled: hasStripeBilling() || hasRazorpayBilling(), ...payload });
    return true;
  }

  if (parts.length === 4 && parts[3] === "billing" && request.method === "GET") {
    sendJson(response, 200, {
      billing: billingSummary(business),
      billingEnabled: hasStripeBilling() || hasRazorpayBilling()
    });
    return true;
  }

  if (parts.length === 5 && parts[3] === "billing" && parts[4] === "checkout" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "billing-checkout")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const session = await createStripeCheckoutSession({
        business,
        user: auth.user,
        plan: body.plan || business.plan,
        origin: requestOrigin(request)
      });
      sendJson(response, 200, {
        ok: true,
        url: session.url,
        id: session.id
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 5 && parts[3] === "billing" && parts[4] === "razorpay" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "billing-razorpay")) {
      return true;
    }
    try {
      const body = await readJsonBody(request, readRawBody);
      const data = await createRazorpaySubscription({
        business,
        user: auth.user,
        plan: body.plan || business.plan,
        origin: requestOrigin(request)
      });
      sendJson(response, 200, { ok: true, ...data });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 5 && parts[3] === "billing" && parts[4] === "portal" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "billing-portal")) {
      return true;
    }

    try {
      const session = await createStripePortalSession({
        business,
        origin: requestOrigin(request)
      });
      sendJson(response, 200, {
        ok: true,
        url: session.url
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "leads" && request.method === "GET") {
    const leads = await listLeadsForBusiness(businessId);
    sendJson(response, 200, { leads });
    return true;
  }

  if (parts.length === 5 && parts[3] === "leads" && request.method === "PATCH") {
    if (rejectIfRateLimited(request, response, "lead-update")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const lead = await updateLeadForBusiness(businessId, parts[4], body);
      sendJson(response, 200, { ok: true, lead });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "bookings" && request.method === "GET") {
    const bookings = await listBookingsForBusiness(businessId);
    sendJson(response, 200, { bookings });
    return true;
  }

  if (parts.length === 4 && parts[3] === "bookings" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "booking-create")) {
      return true;
    }

    try {
      const body = await readJsonBody(request, readRawBody);
      const booking = await createBookingForBusiness({
        businessId,
        phone: body.phone,
        name: body.name,
        courseInterest: body.courseInterest,
        preferredTiming: body.preferredTiming,
        status: body.status || "requested"
      });
      sendJson(response, 201, { ok: true, booking });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "chats" && request.method === "GET") {
    const chats = await listConversationThreads({ businessId, limit: 100 });
    sendJson(response, 200, { chats });
    return true;
  }

  if (parts.length === 5 && parts[3] === "chats" && request.method === "GET") {
    const chatId = decodeURIComponent(parts[4]);
    const messages = await getConversation(chatId, 120, { businessId });
    sendJson(response, 200, {
      chatId,
      messages
    });
    return true;
  }

  // ── Usage ────────────────────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "usage" && request.method === "GET") {
    const usage = await getUsageForBusiness(businessId);
    const plan = business.billing?.plan || business.plan || "basic";
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.basic;
    sendJson(response, 200, { usage, limits, plan });
    return true;
  }

  // ── Advanced Analytics ───────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "analytics" && request.method === "GET") {
    const analytics = await getAdvancedAnalytics(businessId);
    sendJson(response, 200, { ok: true, ...analytics });
    return true;
  }

  // ── Audit Logs ───────────────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "audit" && request.method === "GET") {
    const logs = await listAuditLogs(businessId, 100);
    sendJson(response, 200, { logs });
    return true;
  }

  // ── Team Management ──────────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "team" && request.method === "GET") {
    const members = await listTeamMembers(businessId);
    sendJson(response, 200, { members });
    return true;
  }

  if (parts.length === 4 && parts[3] === "team" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "write")) return true;
    try {
      const body = await readJsonBody(request, readRawBody);
      const member = await inviteTeamMember({
        businessId,
        invitedByUserId: auth.user.id,
        email: body.email,
        role: body.role || "member"
      });
      await appendAuditLog({ businessId, userId: auth.user.id, action: "team.invite", details: { email: body.email, role: body.role } });
      sendTeamInviteEmail({ inviterName: auth.user.name, email: body.email, businessName: business.name, inviteToken: member.inviteToken, appBaseUrl: requestOrigin(request) }).catch(() => {});
      sendJson(response, 201, { ok: true, member });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 5 && parts[3] === "team" && request.method === "DELETE") {
    try {
      await removeTeamMember(businessId, parts[4]);
      await appendAuditLog({ businessId, userId: auth.user.id, action: "team.remove", details: { memberId: parts[4] } });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  // ── API Keys ─────────────────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "api-keys" && request.method === "GET") {
    const keys = await listApiKeys(businessId);
    sendJson(response, 200, { keys });
    return true;
  }

  if (parts.length === 4 && parts[3] === "api-keys" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "write")) return true;
    try {
      const body = await readJsonBody(request, readRawBody);
      const result = await createApiKey({ businessId, userId: auth.user.id, label: body.label });
      await appendAuditLog({ businessId, userId: auth.user.id, action: "apikey.create", details: { label: body.label } });
      sendJson(response, 201, { ok: true, key: result.key, apiKey: result });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 5 && parts[3] === "api-keys" && request.method === "DELETE") {
    try {
      await revokeApiKey(businessId, parts[4]);
      await appendAuditLog({ businessId, userId: auth.user.id, action: "apikey.revoke", details: { keyId: parts[4] } });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  // ── Telegram Integration ─────────────────────────────────────────────────
  if (parts.length === 4 && parts[3] === "whatsapp" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "write")) return true;
    try {
      const parsedBody = await readJsonBody(request, readRawBody);
      const body =
        typeof parsedBody === "string"
          ? JSON.parse(parsedBody)
          : parsedBody;

      const provider = String(body.whatsappProvider || body.provider || "meta").trim().toLowerCase();
      if (provider !== "meta") {
        throw new Error("Self-serve multi-user WhatsApp setup currently supports Meta Cloud API only.");
      }

      const phoneNumberId = String(body.whatsappPhoneNumberId || body.phoneNumberId || "").trim();
      const accessToken = String(body.whatsappAccessToken || body.accessToken || "").trim();
      const displayPhoneNumber = String(
        body.whatsappDisplayPhoneNumber || body.displayPhoneNumber || ""
      ).trim();
      const businessAccountId = String(
        body.whatsappBusinessAccountId || body.businessAccountId || ""
      ).trim();
      const appSecret = String(body.whatsappAppSecret || body.appSecret || "").trim();

      const rawBusiness = await getRawBusinessById(businessId);
      if (!rawBusiness || rawBusiness.userId !== auth.user.id) {
        throw new Error("Business not found.");
      }

      const resolvedPhoneNumberId = phoneNumberId || String(rawBusiness.whatsapp?.phoneNumberId || "").trim();
      const resolvedAccessToken = accessToken || String(rawBusiness.whatsapp?.accessToken || "").trim();
      const resolvedAppSecret = appSecret || String(rawBusiness.whatsapp?.appSecret || "").trim();
      const resolvedDisplayPhoneNumber =
        displayPhoneNumber || String(rawBusiness.whatsapp?.displayPhoneNumber || "").trim();
      const resolvedBusinessAccountId =
        businessAccountId || String(rawBusiness.whatsapp?.businessAccountId || "").trim();

      if (!resolvedPhoneNumberId) throw new Error("WhatsApp Phone Number ID is required.");
      if (!resolvedAccessToken) throw new Error("WhatsApp Access Token is required.");
      if (!resolvedAppSecret && !String(config.whatsappAppSecret || "").trim()) {
        throw new Error("WhatsApp App Secret is required for multi-user Meta webhook verification.");
      }

      const appBase = String(config.appBaseUrl || requestOrigin(request) || "").replace(/\/$/, "");
      let parsedAppBase;
      try {
        parsedAppBase = new URL(appBase);
      } catch {
        throw new Error("APP_BASE_URL is invalid. Set it to your live backend URL before connecting WhatsApp.");
      }

      if (
        parsedAppBase.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(parsedAppBase.hostname)
      ) {
        throw new Error("WhatsApp needs a public HTTPS backend URL. Set APP_BASE_URL to your live backend domain and try again.");
      }

      const phoneInfo = await getWhatsAppPhoneNumberInfo(resolvedPhoneNumberId, {
        provider,
        phoneNumberId: resolvedPhoneNumberId,
        accessToken: resolvedAccessToken
      });
      const verifiedDisplayPhoneNumber =
        String(phoneInfo.display_phone_number || "").trim() || resolvedDisplayPhoneNumber;

      const refreshed = await updateBusinessWhatsApp(auth.user.id, businessId, {
        provider,
        phoneNumberId: resolvedPhoneNumberId,
        accessToken: resolvedAccessToken,
        appSecret: resolvedAppSecret,
        businessAccountId: resolvedBusinessAccountId,
        displayPhoneNumber: verifiedDisplayPhoneNumber,
        webhookUrl: `${appBase}/webhooks/whatsapp`,
        connectedAt: new Date().toISOString(),
        lastError: ""
      });

      await appendAuditLog({
        businessId,
        userId: auth.user.id,
        action: "whatsapp.connect",
        details: {
          provider,
          phoneNumberId: resolvedPhoneNumberId,
          displayPhoneNumber: verifiedDisplayPhoneNumber
        }
      });

      sendJson(response, 200, {
        ok: true,
        whatsapp: refreshed?.whatsapp || {},
        setup: {
          callbackUrl: refreshed?.whatsapp?.webhookUrl || `${appBase}/webhooks/whatsapp`,
          verifyToken: refreshed?.whatsapp?.webhookVerifyToken || "",
          phoneNumberId: resolvedPhoneNumberId,
          displayPhoneNumber: verifiedDisplayPhoneNumber,
          steps: [
            "Open your Meta app webhook settings.",
            "Set the callback URL to the value shown here.",
            "Set the verify token exactly as shown here.",
            "Subscribe the app to WhatsApp message events."
          ]
        }
      });
    } catch (error) {
      await updateBusinessWhatsApp(auth.user.id, businessId, {
        lastError: error.message
      }).catch(() => {});
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "whatsapp" && request.method === "DELETE") {
    try {
      const rawBusiness = await getRawBusinessById(businessId);
      if (!rawBusiness || rawBusiness.userId !== auth.user.id) {
        throw new Error("Business not found.");
      }

      const refreshed = await updateBusinessWhatsApp(auth.user.id, businessId, {
        provider: "meta",
        displayPhoneNumber: "",
        phoneNumberId: "",
        businessAccountId: "",
        accessToken: "",
        appSecret: "",
        webhookUrl: "",
        webhookVerifiedAt: "",
        connectedAt: "",
        lastError: ""
      });
      await appendAuditLog({ businessId, userId: auth.user.id, action: "whatsapp.disconnect", details: {} });
      sendJson(response, 200, { ok: true, whatsapp: refreshed?.whatsapp || {} });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "telegram" && request.method === "POST") {
    if (rejectIfRateLimited(request, response, "write")) return true;
    try {
      const parsedBody = await readJsonBody(request, readRawBody);
      const body =
        typeof parsedBody === "string"
          ? JSON.parse(parsedBody)
          : parsedBody;
      const token = String(body.token || "").trim();
      if (!token) throw new Error("Telegram bot token is required.");

      const rawBusiness = await getRawBusinessById(businessId);
      if (!rawBusiness || rawBusiness.userId !== auth.user.id) {
        throw new Error("Business not found.");
      }

      const conflict = await findBusinessByTelegramToken(token);
      if (conflict && conflict.id !== businessId) {
        throw new Error("This Telegram bot is already connected to another workspace. Disconnect it there first.");
      }

      const botInfo = await getTelegramBotInfo(token);

      const appBase = String(config.appBaseUrl || requestOrigin(request) || "").replace(/\/$/, "");
      let parsedAppBase;
      try {
        parsedAppBase = new URL(appBase);
      } catch {
        throw new Error("APP_BASE_URL is invalid. Set it to your live backend URL before connecting Telegram.");
      }

      if (
        parsedAppBase.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(parsedAppBase.hostname)
      ) {
        throw new Error("Telegram needs a public HTTPS backend URL. Set APP_BASE_URL to your live backend domain and try again.");
      }

      const webhookUrl = `${appBase}/webhooks/telegram/${businessId}`;
      await setTelegramWebhook(token, webhookUrl);
      const webhookInfo = await getTelegramWebhookInfo(token);

      if (String(webhookInfo.result?.url || "") !== webhookUrl) {
        throw new Error("Telegram did not confirm the webhook URL. Please try again in a few seconds.");
      }

      const previousToken = String(rawBusiness.telegram?.token || "").trim();
      if (previousToken && previousToken !== token) {
        await deleteTelegramWebhook(previousToken).catch((error) => {
          console.warn(`Failed to remove previous Telegram webhook for ${businessId}: ${error.message}`);
        });
      }

      await updateBusinessTelegram(auth.user.id, businessId, {
        token,
        botUsername: botInfo.result?.username || "",
        botName: botInfo.result?.first_name || "",
        webhookUrl,
        connectedAt: new Date().toISOString(),
        webhookVerifiedAt: new Date().toISOString(),
        lastError: ""
      });

      const refreshed = await getBusinessForUser(auth.user.id, businessId);
      await appendAuditLog({ businessId, userId: auth.user.id, action: "telegram.connect", details: { username: botInfo.result?.username } });
      sendJson(response, 200, {
        ok: true,
        bot: { username: botInfo.result?.username, name: botInfo.result?.first_name },
        telegram: refreshed?.telegram || {}
      });
    } catch (error) {
      await updateBusinessTelegram(auth.user.id, businessId, {
        lastError: error.message,
        webhookVerifiedAt: ""
      }).catch(() => {});
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (parts.length === 4 && parts[3] === "telegram" && request.method === "DELETE") {
    try {
      const rawBusiness = await getRawBusinessById(businessId);
      if (!rawBusiness || rawBusiness.userId !== auth.user.id) {
        throw new Error("Business not found.");
      }

      const current = rawBusiness.telegram?.token;
      if (current) {
        await deleteTelegramWebhook(current).catch(() => {});
      }
      await updateBusinessTelegram(auth.user.id, businessId, {
        token: "",
        botUsername: "",
        botName: "",
        webhookUrl: "",
        connectedAt: "",
        webhookVerifiedAt: "",
        lastError: ""
      });
      const refreshed = await getBusinessForUser(auth.user.id, businessId);
      await appendAuditLog({ businessId, userId: auth.user.id, action: "telegram.disconnect", details: {} });
      sendJson(response, 200, { ok: true, telegram: refreshed?.telegram || {} });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  // ── Admin Routes (SaaS owner only) ───────────────────────────────────────
  if (url.pathname.startsWith("/api/admin/")) {
    const isAdmin = await isAdminUser(auth.user.id);
    if (!isAdmin) {
      sendJson(response, 403, { error: "Admin access required." });
      return true;
    }

    if (url.pathname === "/api/admin/stats" && request.method === "GET") {
      const stats = await getAdminStats();
      sendJson(response, 200, { ok: true, stats });
      return true;
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const users = await adminListAllUsers();
      sendJson(response, 200, { ok: true, users });
      return true;
    }

    if (url.pathname === "/api/admin/businesses" && request.method === "GET") {
      const businesses = await adminListAllBusinesses();
      sendJson(response, 200, { ok: true, businesses });
      return true;
    }

    if (url.pathname.startsWith("/api/admin/businesses/") && request.method === "POST") {
      const adminParts = url.pathname.split("/").filter(Boolean);
      const bizId = adminParts[3];
      const action = adminParts[4];
      if (action === "suspend") {
        await adminSuspendBusiness(bizId, true);
        sendJson(response, 200, { ok: true });
        return true;
      }
      if (action === "unsuspend") {
        await adminSuspendBusiness(bizId, false);
        sendJson(response, 200, { ok: true });
        return true;
      }
    }

    sendJson(response, 404, { error: "Admin route not found." });
    return true;
  }

  sendJson(response, 404, { error: "Not found" });
  return true;
}
