const app = document.querySelector("#app");
const pageParams = new URLSearchParams(window.location.search);
const dashboardTabs = new Set(["overview", "leads", "chats", "bookings", "billing", "team", "apikeys", "audit", "analytics", "settings", "admin"]);
const WHATSAPP_COMING_SOON = true;
const BILLING_ENABLED = false;
const PENDING_PLATFORM_SETUP_KEY = "pendingPlatformSetup";

function normalizeTab(value) {
  const tab = String(value || "").trim().toLowerCase();
  return dashboardTabs.has(tab) ? tab : "overview";
}

function initialBillingNotice() {
  const value = String(pageParams.get("billing") || "").trim().toLowerCase();
  if (value === "success") {
    return {
      tone: "success",
      message: "Stripe checkout completed. Subscription status will refresh as billing webhooks arrive."
    };
  }

  if (value === "cancel") {
    return {
      tone: "warn",
      message: "Stripe checkout was canceled. Your existing subscription is unchanged."
    };
  }

  return null;
}

function initialAuthNotice() {
  const value = String(pageParams.get("error") || "").trim().toLowerCase();
  if (value === "google_not_configured") {
    return "Google sign-in is not enabled yet. Please continue with email.";
  }
  if (value === "google_auth_failed") {
    return "Google sign-in could not be completed. Please continue with email.";
  }
  return "";
}

function normalizeSelectedProduct(value) {
  const product = String(value || "").trim().toLowerCase();
  if (product === "telegram") {
    return "telegram";
  }
  if (!WHATSAPP_COMING_SOON && product === "whatsapp") {
    return "whatsapp";
  }
  return WHATSAPP_COMING_SOON ? "telegram" : "whatsapp";
}

const state = {
  route: window.location.pathname === "/app" ? "app" : "landing",
  authChecked: false,
  user: null,
  plans: [],
  billingEnabled: false,
  billingProviders: {
    stripe: false,
    razorpay: false
  },
  userBusinesses: [],
  selectedBusiness: null,
  analytics: null,
  advancedAnalytics: null,
  readiness: { score: 0, total: 0, items: [] },
  billing: null,
  billingNotice: initialBillingNotice(),
  authNotice: initialAuthNotice(),
  leads: [],
  bookings: [],
  chats: [],
  activeChatId: "",
  activeChatMessages: [],
  tab: normalizeTab(pageParams.get("tab")),
  authMode: ["login","signup","platform"].includes(pageParams.get("mode")) ? pageParams.get("mode") : "signup",
  showBotLivePopup: false,
  teamMembers: [],
  apiKeys: [],
  auditLogs: [],
  usage: null,
  usageLimits: null,
  adminStats: null,
  adminUsers: [],
  adminBusinesses: [],
  onboardingStep: 0,
  showOnboarding: false,
  resetToken: "",
  authSubMode: "",
  selectedProduct: normalizeSelectedProduct(pageParams.get("product")),
  telegramSetup: false,
  showPaymentPopup: false,
  pendingPlatformSetup: null,
  setupStep: "choice",
  billingActivated: false,
  showDisconnectModal: false,
  disconnectPlatform: null
};

function normalizeBillingProviders(value = {}) {
  return {
    stripe: value?.stripe === true,
    razorpay: value?.razorpay === true
  };
}

function hasEnabledBillingProvider() {
  if (!BILLING_ENABLED) return false;
  return state.billingProviders.stripe || state.billingProviders.razorpay;
}

function paymentCtaLabel(defaultLabel) {
  return hasEnabledBillingProvider() ? "Continue to Payment →" : defaultLabel;
}

function renderPaymentButtons({ className = "payment-buttons", style = "margin-top:4px;" } = {}) {
  const buttons = [];

  if (state.billingProviders.razorpay) {
    buttons.push(`
      <button class="button razorpay-btn" type="button" data-upgrade-plan="pro" data-provider="razorpay" style="flex:1;">
        🇮🇳 Pay ₹2,499/mo
      </button>
    `);
  }

  if (state.billingProviders.stripe) {
    buttons.push(`
      <button class="button stripe-btn" type="button" data-upgrade-plan="pro" data-provider="stripe" style="flex:1;">
        🌍 Pay $39/mo
      </button>
    `);
  }

  if (!buttons.length) {
    return `
      <div class="notice warn" style="margin-top:4px;">
        Payments are not configured yet. You can finish setup now and enable billing as soon as a payment provider is connected.
      </div>
    `;
  }

  return `<div class="${className}" style="${style}">${buttons.join("")}</div>`;
}

function readStoredPendingPlatformSetup() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_PLATFORM_SETUP_KEY) || "null");
  } catch {
    return null;
  }
}

function writeStoredPendingPlatformSetup(value) {
  if (!value) {
    sessionStorage.removeItem(PENDING_PLATFORM_SETUP_KEY);
    return;
  }

  sessionStorage.setItem(PENDING_PLATFORM_SETUP_KEY, JSON.stringify(value));
}

function attachPaymentButtonHandlers(root = document) {
  root.querySelectorAll("[data-upgrade-plan]").forEach((button) => {
    button.addEventListener("click", async () => {
      const businessId = state.selectedBusiness?.id;
      if (!businessId) {
        alert("Please select a workspace before starting payment.");
        return;
      }

      const plan = button.dataset.upgradePlan;
      const provider = button.dataset.provider || "razorpay";
      const originalLabel = button.innerHTML;
      const pendingSetup = state.pendingPlatformSetup;

      try {
        button.disabled = true;
        button.textContent = provider === "stripe" ? "Redirecting..." : "Opening payment...";

        if (pendingSetup) {
          writeStoredPendingPlatformSetup(pendingSetup);
        }

        if (provider === "stripe") {
          const payload = await api(`/api/businesses/${encodeURIComponent(businessId)}/billing/checkout`, {
            method: "POST",
            body: { plan }
          });

          if (!payload.url) {
            throw new Error("Stripe checkout did not return a payment link.");
          }

          window.location.href = payload.url;
          return;
        }

        const payload = await api(`/api/businesses/${encodeURIComponent(businessId)}/billing/razorpay`, {
          method: "POST",
          body: { plan }
        });

        if (!payload.subscriptionId || !payload.keyId) {
          throw new Error("Razorpay checkout did not return subscription details.");
        }

        if (!window.Razorpay) {
          throw new Error("Razorpay checkout is still loading. Please refresh and try again.");
        }

        const rzp = new window.Razorpay({
          key: payload.keyId,
          subscription_id: payload.subscriptionId,
          name: payload.businessName || "swift-deploy.in",
          description: `${plan} Plan Subscription`,
          prefill: { email: payload.userEmail, name: payload.userName },
          theme: { color: "#7c6fff" },
          handler: function() {
            window.location.href = payload.callbackUrl || "/app?tab=billing&billing=success";
          },
          modal: {
            ondismiss: function() {
              writeStoredPendingPlatformSetup(null);
              button.disabled = false;
              button.innerHTML = originalLabel;
            }
          }
        });

        rzp.open();
        button.disabled = false;
        button.innerHTML = originalLabel;
      } catch (error) {
        writeStoredPendingPlatformSetup(null);
        button.disabled = false;
        button.innerHTML = originalLabel;
        alert(error.message);
      }
    });
  });
}

function renderCheckIcon({ size = 16, tone = "default" } = {}) {
  const dimension = Number(size) || 16;
  return `
    <span class="feature-list-icon feature-list-icon--${tone}" style="width:${dimension}px;height:${dimension}px;" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="10" fill="currentColor" fill-opacity="0.16"/>
        <path d="M5.75 10.25L8.75 13.25L14.25 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
  `;
}

function renderFeatureList(items = [], className = "") {
  return `
    <ul class="${className}">
      ${items.map((item) => `
        <li>
          <span class="feature-list-item">
            ${renderCheckIcon()}
            <span class="feature-list-label">${escapeHtml(item)}</span>
          </span>
        </li>
      `).join("")}
    </ul>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isWhatsAppComingSoon() {
  return WHATSAPP_COMING_SOON;
}

function renderPlatformComingSoonCover() {
  return `
    <div class="platform-disabled-cover" aria-hidden="true">
      <div class="platform-disabled-strip"></div>
      <div class="platform-disabled-popup">Coming soon</div>
    </div>
  `;
}

function renderDisabledPlatformSurface(tagName, className, content, extraAttrs = "") {
  return `<${tagName} class="${className} platform-disabled-card" data-platform-disabled="whatsapp" aria-disabled="true" ${extraAttrs}>${content}${renderPlatformComingSoonCover()}</${tagName}>`;
}

function isTelegramConnected(business = state.selectedBusiness) {
  const telegram = business?.telegram || {};
  return Boolean(telegram.configured || telegram.tokenConfigured || telegram.token);
}

function isWhatsAppConfigured(business = state.selectedBusiness) {
  if (isWhatsAppComingSoon()) {
    return false;
  }
  const whatsapp = business?.whatsapp || {};
  return Boolean(whatsapp.configured || (whatsapp.phoneNumberId && whatsapp.accessTokenConfigured));
}

function isWhatsAppReady(business = state.selectedBusiness) {
  if (isWhatsAppComingSoon()) {
    return false;
  }
  const whatsapp = business?.whatsapp || {};
  return Boolean(isWhatsAppConfigured(business) && whatsapp.webhookVerifiedAt);
}

function showWhatsAppSetupAlert(setup = {}) {
  if (isWhatsAppComingSoon()) {
    return;
  }
  if (!setup.callbackUrl || !setup.verifyToken) {
    return;
  }
  const steps = Array.isArray(setup.steps) && setup.steps.length
    ? `\n\nNext steps:\n${setup.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`
    : "";
  alert(
    `WhatsApp connected. Complete the Meta webhook setup before replies can start.\n\nCallback URL:\n${setup.callbackUrl}\n\nVerify Token:\n${setup.verifyToken}${steps}`
  );
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseFaqText(value) {
  return splitLines(value).map((line) => {
    const [question, ...answerParts] = line.split("|");
    return {
      question: (question || "").trim(),
      answer: answerParts.join("|").trim()
    };
  }).filter((item) => item.question && item.answer);
}

function serializeFaqs(items = []) {
  return (items || [])
    .map((item) => `${item.question} | ${item.answer}`)
    .join("\n");
}

function parseCourseText(value) {
  return splitLines(value).map((line) => {
    const [name, timings, fee, keywords, description] = line.split("|").map((entry) => (entry || "").trim());
    return {
      name,
      timings: timings ? timings.split(",").map((entry) => entry.trim()).filter(Boolean) : [],
      fee,
      keywords: keywords ? keywords.split(",").map((entry) => entry.trim()).filter(Boolean) : [],
      description
    };
  }).filter((item) => item.name);
}

function serializeCourses(items = []) {
  return (items || [])
    .map((item) => [
      item.name,
      (item.timings || []).join(", "),
      item.fee || "",
      (item.keywords || []).join(", "),
      item.description || ""
    ].join(" | "))
    .join("\n");
}

function formatPlanPrice(value) {
  const amount = Number(value || 0);
  if (!amount) return "Custom";
  return `₹${amount.toLocaleString("en-IN", { useGrouping: true })}`;
}

function syncDashboardUrl() {
  if (state.route !== "app" || !window.history?.replaceState) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  params.delete("mode");
  params.delete("billing");

  if (state.tab && state.tab !== "overview") {
    params.set("tab", state.tab);
  } else {
    params.delete("tab");
  }

  if (state.selectedBusiness?.id) {
    params.set("businessId", state.selectedBusiness.id);
  } else {
    params.delete("businessId");
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

async function api(path, options = {}) {
  const settings = {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    credentials: "same-origin"
  };

  if (options.body) {
    settings.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, settings);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function loadPlans() {
  const payload = await api("/api/plans");
  state.plans = payload.plans || [];
  state.billingEnabled = payload.billingEnabled === true;
  state.billingProviders = normalizeBillingProviders(payload.billingProviders);
}

async function loadAuth() {
  const payload = await api("/api/auth/me");
  state.authChecked = true;
  state.user = payload.authenticated ? payload.user : null;
}

async function loadBootstrap(businessId = "") {
  const query = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
  const payload = await api(`/api/app/bootstrap${query}`);
  state.user = payload.user;
  state.plans = payload.plans || [];
  state.billingEnabled = payload.billingEnabled === true;
  state.billingProviders = normalizeBillingProviders(payload.billingProviders);
  state.userBusinesses = payload.userBusinesses || [];
  state.selectedBusiness = payload.selectedBusiness || null;
  state.analytics = payload.analytics || null;
  state.readiness = payload.readiness || { score: 0, total: 0, items: [] };
  state.billing = payload.selectedBusiness?.billing || null;
  state.leads = payload.leads || [];
  state.bookings = payload.bookings || [];
  state.chats = payload.chats || [];
  syncDashboardUrl();

  if (state.selectedBusiness) {
    const bizId = state.selectedBusiness.id;
    const [teamData, keyData, auditData, usageData, analyticsData] = await Promise.allSettled([
      api(`/api/businesses/${encodeURIComponent(bizId)}/team`),
      api(`/api/businesses/${encodeURIComponent(bizId)}/api-keys`),
      api(`/api/businesses/${encodeURIComponent(bizId)}/audit`),
      api(`/api/businesses/${encodeURIComponent(bizId)}/usage`),
      api(`/api/businesses/${encodeURIComponent(bizId)}/analytics`)
    ]);
    state.teamMembers = teamData.status === "fulfilled" ? teamData.value.members || [] : [];
    state.apiKeys = keyData.status === "fulfilled" ? keyData.value.keys || [] : [];
    state.auditLogs = auditData.status === "fulfilled" ? auditData.value.logs || [] : [];
    state.usage = usageData.status === "fulfilled" ? usageData.value.usage || null : null;
    state.usageLimits = usageData.status === "fulfilled" ? usageData.value.limits || null : null;
    state.advancedAnalytics = analyticsData.status === "fulfilled" ? analyticsData.value || null : null;

    if (state.user?.isAdmin) {
      const [adminStatsData, adminUsersData, adminBizData] = await Promise.allSettled([
        api("/api/admin/stats"),
        api("/api/admin/users"),
        api("/api/admin/businesses")
      ]);
      state.adminStats = adminStatsData.status === "fulfilled" ? adminStatsData.value.stats || null : null;
      state.adminUsers = adminUsersData.status === "fulfilled" ? adminUsersData.value.users || [] : [];
      state.adminBusinesses = adminBizData.status === "fulfilled" ? adminBizData.value.businesses || [] : [];
    }
  }

  if (!state.activeChatId && state.chats.length) {
    await openChat(state.chats[0].chatId);
  } else if (state.activeChatId) {
    const stillExists = state.chats.some((chat) => chat.chatId === state.activeChatId);
    if (stillExists) {
      await openChat(state.activeChatId);
    } else {
      state.activeChatId = "";
      state.activeChatMessages = [];
    }
  }
}

async function openChat(chatId) {
  if (!state.selectedBusiness) {
    return;
  }
  state.activeChatId = chatId;
  const payload = await api(
    `/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/chats/${encodeURIComponent(chatId)}`
  );
  state.activeChatMessages = payload.messages || [];
  render();
}

function renderLanding() {
  app.innerHTML = `
    <div class="landing">

      <!-- NAV -->
      <nav class="landing-nav">
        <div class="shell">
          <div class="nav-inner">
            <div class="logo">
              <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </div>
            <div class="nav-links"></div>
            <div class="nav-actions">
              <a class="ghost-button" href="/app?mode=login">Log in</a>
              <a class="button" href="/app?mode=signup">Get started now</a>
            </div>
          </div>
        </div>
      </nav>

      <!-- HERO -->
      <section class="lp-hero">
        <div class="lp-hero-bg">
          <div class="lp-hero-grid-bg"></div>
          <div class="lp-hero-glow lp-hero-glow--purple"></div>
          <div class="lp-hero-glow lp-hero-glow--blue"></div>
        </div>
        <div class="shell">
          <div class="lp-hero-inner">

            <div class="lp-hero-badge">
              <span class="lp-hero-badge-dot"></span>
              AI-powered &bull; Instant replies &bull; Any language
            </div>

            <h1 class="lp-h1">One AI. Every platform.<br><span class="lp-h1-accent">Zero manual work.</span></h1>
            <p class="lp-sub">Your business gets an AI bot that replies instantly 24/7, speaks any language, and goes live in under 2 minutes &mdash; no code, no complexity.</p>

            <div class="lp-hero-ctas">
              <a class="ghost-button lp-hero-cta-secondary" href="/app?mode=login">Log in to dashboard</a>
            </div>

            <div class="lp-trust-bar">
              <div class="lp-trust-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                No credit card required
              </div>
              <span class="lp-trust-sep">&bull;</span>
              <div class="lp-trust-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Live in under 2 minutes
              </div>
              <span class="lp-trust-sep">&bull;</span>
              <div class="lp-trust-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                50+ languages supported
              </div>
            </div>


          </div>
        </div>
      </section>
      <!-- FEATURES -->
      <section class="lp-section" id="features">
        <div class="shell">
          <div class="lp-section-header">
            <span class="eyebrow">Platform Features</span>
            <h2 class="lp-h2">Everything your business needs,<br>nothing you don't.</h2>
            <p class="lp-section-sub">Built for businesses that want to automate customer conversations on WhatsApp and Telegram — zero technical skills required.</p>
          </div>
          <div class="lp-features">
            <div class="lp-feature-card">
              <div class="lp-feature-icon">⚡</div>
              <h3>Instant AI Replies</h3>
              <p>Your bot replies to every message in under 2 seconds — any question, any time of day, no manual effort required.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🌍</div>
              <h3>Any Language, Anytime</h3>
              <p>Hindi, Tamil, Arabic, Spanish — your bot automatically matches the language of whoever is messaging it. Zero setup.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">💬</div>
              <h3>Unified Inbox</h3>
              <p>One clean workspace for AI replies, leads, chats, and business automation from a single dashboard.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🚀</div>
              <h3>Zero Setup</h3>
              <p>Sign up, paste your credentials, subscribe — your bot is live in under 2 minutes. No technical knowledge required.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">💡</div>
              <h3>No Coding Needed</h3>
              <p>Everything is managed from a clean dashboard. Change bot behavior, monitor activity, and manage billing — all in one place.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🔐</div>
              <h3>Secure &amp; Private</h3>
              <p>Your credentials are encrypted at rest. All webhook traffic is verified. Your users' conversations are never shared.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="lp-whatsapp-contact" id="whatsapp">
        <div class="shell">
          <div class="lp-whatsapp-inner">
            <p class="lp-whatsapp-subtitle">Start a conversation with our AI assistant on WhatsApp</p>
            <a
              class="lp-whatsapp-button"
              href="https://wa.me/918837663683?text=Hi%20I%20want%20to%20use%20the%20AI%20bot"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat on WhatsApp with swift-deploy.in AI assistant"
            >
              <svg class="lp-whatsapp-button-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M16.01 3.2c-7.03 0-12.75 5.64-12.75 12.58 0 2.24.61 4.42 1.76 6.33L3.2 28.8l6.88-1.78a12.93 12.93 0 0 0 5.93 1.5c7.03 0 12.75-5.64 12.75-12.58S23.04 3.2 16.01 3.2Zm0 23.16c-1.95 0-3.86-.52-5.53-1.51l-.4-.24-4.08 1.06 1.09-3.9-.26-.41a10.2 10.2 0 0 1-1.58-5.58c0-5.75 4.83-10.43 10.76-10.43s10.76 4.68 10.76 10.43-4.83 10.58-10.76 10.58Zm5.91-7.82c-.32-.16-1.91-.93-2.21-1.04-.3-.11-.52-.16-.74.16-.22.32-.85 1.04-1.04 1.25-.19.22-.38.24-.7.08-.32-.16-1.36-.49-2.6-1.56-.96-.84-1.61-1.87-1.8-2.19-.19-.32-.02-.49.14-.65.15-.14.32-.38.49-.57.16-.19.22-.32.32-.54.11-.22.05-.41-.03-.57-.08-.16-.74-1.76-1.01-2.41-.27-.63-.54-.54-.74-.55h-.63c-.22 0-.57.08-.87.41-.3.32-1.14 1.1-1.14 2.68s1.17 3.11 1.34 3.33c.16.22 2.3 3.46 5.58 4.85.78.33 1.39.53 1.86.68.78.25 1.49.21 2.05.13.63-.09 1.91-.77 2.18-1.52.27-.75.27-1.39.19-1.52-.08-.13-.3-.21-.62-.37Z"/>
              </svg>
              <span>Chat on WhatsApp</span>
            </a>

            <div class="lp-whatsapp-qr" aria-label="QR code that opens WhatsApp chat">
              <div class="lp-whatsapp-qr-frame">
                <svg class="lp-whatsapp-qr-code" xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 41 41" shape-rendering="crispEdges" role="img" aria-label="Scan to open WhatsApp chat link">
                  <path fill="#ffffff" d="M0 0h41v41H0z"/>
                  <path stroke="#111827" d="M2 2.5h7m5 0h1m3 0h1m5 0h1m1 0h1m2 0h2m1 0h7M2 3.5h1m5 0h1m2 0h1m1 0h2m1 0h2m1 0h2m1 0h2m1 0h3m1 0h2m1 0h1m5 0h1M2 4.5h1m1 0h3m1 0h1m1 0h1m2 0h3m1 0h2m1 0h1m2 0h2m1 0h4m2 0h1m1 0h3m1 0h1M2 5.5h1m1 0h3m1 0h1m1 0h3m1 0h2m2 0h1m3 0h4m4 0h1m1 0h1m1 0h3m1 0h1M2 6.5h1m1 0h3m1 0h1m1 0h4m1 0h1m1 0h4m3 0h1m1 0h3m3 0h1m1 0h3m1 0h1M2 7.5h1m5 0h1m1 0h2m2 0h2m2 0h2m9 0h1m2 0h1m5 0h1M2 8.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M10 9.5h2m1 0h1m3 0h1m1 0h2m1 0h1m1 0h1m3 0h2M2 10.5h1m1 0h5m2 0h3m1 0h1m1 0h2m2 0h1m1 0h3m2 0h3m1 0h5M3 11.5h1m1 0h3m7 0h3m1 0h2m1 0h1m1 0h1m1 0h1m2 0h1m1 0h4m1 0h2M3 12.5h2m1 0h1m1 0h6m3 0h2m1 0h2m2 0h1m1 0h4m1 0h2m4 0h2M2 13.5h3m1 0h1m6 0h2m2 0h1m3 0h3m3 0h1m3 0h1m1 0h3m2 0h1M2 14.5h1m1 0h2m1 0h3m6 0h2m3 0h1m1 0h1m1 0h1m2 0h1m1 0h5m2 0h2M2 15.5h2m1 0h3m3 0h7m2 0h1m3 0h1m2 0h3m3 0h1m3 0h2M3 16.5h6m3 0h1m3 0h3m1 0h2m1 0h3m2 0h3m2 0h3m2 0h1M3 17.5h2m5 0h1m1 0h1m4 0h2m3 0h4m1 0h1m2 0h5m3 0h1M2 18.5h2m1 0h2m1 0h2m1 0h3m6 0h4m1 0h2m3 0h4m2 0h2M2 19.5h1m1 0h1m1 0h1m5 0h3m2 0h3m6 0h1m2 0h1m2 0h2m1 0h3M2 20.5h3m1 0h4m1 0h1m1 0h1m2 0h1m5 0h5m2 0h2m1 0h2m2 0h3M2 21.5h1m1 0h2m1 0h1m5 0h4m1 0h3m2 0h2m3 0h7m1 0h1m1 0h1M2 22.5h3m1 0h1m1 0h1m2 0h1m2 0h3m1 0h1m1 0h1m2 0h1m1 0h4m3 0h1m1 0h2M5 23.5h3m6 0h4m1 0h2m1 0h2m3 0h1m7 0h1m2 0h1M2 24.5h3m3 0h1m2 0h6m1 0h2m2 0h2m1 0h1m2 0h3m2 0h3M2 25.5h1m3 0h1m3 0h1m4 0h2m2 0h2m2 0h1m1 0h2m2 0h6m3 0h1M2 26.5h3m2 0h2m1 0h1m1 0h1m1 0h1m3 0h1m2 0h1m1 0h1m1 0h2m2 0h5m2 0h2M2 27.5h2m1 0h2m3 0h2m1 0h1m1 0h3m1 0h2m1 0h1m4 0h3m2 0h1m2 0h2M2 28.5h1m1 0h1m1 0h4m1 0h3m1 0h1m1 0h2m2 0h1m2 0h1m4 0h1m1 0h1m5 0h2M2 29.5h1m2 0h2m2 0h2m2 0h1m3 0h1m2 0h5m1 0h1m1 0h3m2 0h2M2 30.5h1m3 0h1m1 0h1m2 0h2m1 0h2m1 0h2m1 0h2m1 0h6m1 0h6m1 0h1M10 31.5h1m1 0h2m2 0h3m3 0h1m1 0h1m1 0h1m1 0h3m3 0h2m2 0h1M2 32.5h7m2 0h1m5 0h1m2 0h1m3 0h1m5 0h1m1 0h1m1 0h1m1 0h3M2 33.5h1m5 0h1m1 0h3m1 0h2m1 0h1m3 0h1m8 0h1m3 0h2m1 0h2M2 34.5h1m1 0h3m1 0h1m1 0h3m1 0h2m4 0h7m1 0h7m1 0h1M2 35.5h1m1 0h3m1 0h1m1 0h2m2 0h1m2 0h3m3 0h1m3 0h2m2 0h2m1 0h1m1 0h1m1 0h1M2 36.5h1m1 0h3m1 0h1m1 0h1m4 0h2m5 0h1m3 0h2m2 0h1m4 0h1m2 0h1M2 37.5h1m5 0h1m4 0h1m4 0h2m3 0h1m1 0h3m1 0h1m1 0h1m2 0h3m1 0h1M2 38.5h7m1 0h4m1 0h1m2 0h1m3 0h2m2 0h2m1 0h2m1 0h1m1 0h2m1 0h2"/>
                </svg>
              </div>
              <div class="lp-whatsapp-qr-label">Scan to chat on WhatsApp</div>
            </div>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="lp-footer">
        <div class="shell">
          <div class="lp-footer-inner">
            <div class="logo">
              <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </div>
            <div class="lp-footer-links">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="/data-deletion">Data Deletion</a>
              <a href="/app?mode=login">Dashboard</a>
            </div>
            <div class="lp-footer-copy">Â© 2026 swift-deploy.in. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  `;
}

function renderPlatformChoice() {
  state.authMode = "signup";
  if (pageParams.get("mode") === "platform") {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "signup");
    window.history.replaceState({}, "", nextUrl);
  }
  renderAuth();
}

function renderAuth() {
  const isSignup = state.authMode === "signup";
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-left">
        <a class="logo" href="/">
          <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="28" height="28" />
          <span class="logo-name">swift-deploy.in</span>
        </a>
        <div class="auth-left-content">
          <h2 class="auth-left-title">The smartest way to handle WhatsApp at scale.</h2>
          <p class="auth-left-sub">Automate lead capture, demo bookings, and customer replies — powered by AI, delivered on WhatsApp.</p>
          <div class="auth-left-features">
            <div class="auth-left-feature">
              <span class="auth-left-feature-icon">⚡</span>
              <span>Replies in under 60 seconds, 24/7</span>
            </div>
            <div class="auth-left-feature">
              <span class="auth-left-feature-icon">📊</span>
              <span>Live dashboard for leads & bookings</span>
            </div>
            <div class="auth-left-feature">
              <span class="auth-left-feature-icon">🔒</span>
              <span>Secure, encrypted, GDPR-ready</span>
            </div>
          </div>
        </div>
        <div class="auth-left-footer">Â© 2026 swift-deploy.in Â· <a href="/privacy">Privacy</a> Â· <a href="/terms">Terms</a></div>
      </div>

      <div class="auth-right">
        <div class="auth-form-wrap">
          <div class="auth-form-header">
            <h1 class="auth-form-title">${isSignup ? "Create your account" : "Welcome back"}</h1>
            <p class="auth-form-sub">${isSignup ? "Start your free workspace — no credit card required." : "Sign in to your swift-deploy.in dashboard."}</p>
          </div>

          ${state.authNotice ? `<div class="auth-form-error auth-form-error--visible">${escapeHtml(state.authNotice)}</div>` : ""}

          <div class="auth-mode-toggle">
            <button class="auth-mode-btn ${isSignup ? "active" : ""}" data-auth-mode="signup">Sign up</button>
            <button class="auth-mode-btn ${!isSignup ? "active" : ""}" data-auth-mode="login">Log in</button>
          </div>

          ${isSignup ? `
            <form id="signup-form" novalidate>
              <div id="signup-error" class="auth-form-error" style="display:none;"></div>
              <div class="field">
                <label>Full name</label>
                <input class="input" name="name" placeholder="Shubham Rana" autocomplete="name" />
                <span class="field-error" id="err-name"></span>
              </div>
              <div class="field">
                <label>Business name</label>
                <input class="input" name="businessName" placeholder="Your company or project name" autocomplete="organization" />
                <span class="field-error" id="err-businessName"></span>
              </div>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email" />
                <span class="field-error" id="err-email"></span>
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" name="password" placeholder="Minimum 8 characters" autocomplete="new-password" />
                <span class="field-error" id="err-password"></span>
              </div>
              <div class="form-actions">
                <button class="button" type="submit" id="signup-btn" style="width:100%;justify-content:center;">Create account →</button>
              </div>
            </form>
          ` : `
            <form id="login-form" novalidate>
              <div id="login-error" class="auth-form-error" style="display:none;"></div>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email" />
                <span class="field-error" id="err-email"></span>
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" name="password" placeholder="Your password" autocomplete="current-password" />
                <span class="field-error" id="err-password"></span>
              </div>
              <div class="form-actions">
                <button class="button" type="submit" id="login-btn" style="width:100%;justify-content:center;">Log in →</button>
              </div>
            </form>
          `}
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      render();
    });
  });

  function setFieldError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = msg ? "block" : "none"; }
  }
  function clearFieldErrors(ids) { ids.forEach((id) => setFieldError(id, "")); }

  const signupForm = document.querySelector("#signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldErrors(["err-name", "err-businessName", "err-email", "err-password"]);
      const payload = formToObject(signupForm);
      let valid = true;
      if (!payload.name?.trim()) { setFieldError("err-name", "Full name is required."); valid = false; }
      if (!payload.businessName?.trim()) { setFieldError("err-businessName", "Business name is required."); valid = false; }
      if (!payload.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { setFieldError("err-email", "Enter a valid email address."); valid = false; }
      if (!payload.password || payload.password.length < 8) { setFieldError("err-password", "Password must be at least 8 characters."); valid = false; }
      if (!valid) return;
      const btn = document.querySelector("#signup-btn");
      const errEl = document.querySelector("#signup-error");
      if (btn) { btn.disabled = true; btn.textContent = "Creating account..."; }
      if (errEl) errEl.style.display = "none";
      try {
        await api("/api/auth/signup", { method: "POST", body: payload });
        await loadBootstrap(pageParams.get("businessId") || "");
        render();
      } catch (error) {
        if (errEl) { errEl.textContent = error.message; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = "Create account →"; }
      }
    });
  }

  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldErrors(["err-email", "err-password"]);
      const payload = formToObject(loginForm);
      let valid = true;
      if (!payload.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { setFieldError("err-email", "Enter a valid email address."); valid = false; }
      if (!payload.password?.trim()) { setFieldError("err-password", "Password is required."); valid = false; }
      if (!valid) return;
      const btn = document.querySelector("#login-btn");
      const errEl = document.querySelector("#login-error");
      if (btn) { btn.disabled = true; btn.textContent = "Logging in..."; }
      if (errEl) errEl.style.display = "none";
      try {
        await api("/api/auth/login", { method: "POST", body: payload });
        await loadBootstrap(pageParams.get("businessId") || "");
        render();
      } catch (error) {
        if (errEl) { errEl.textContent = error.message; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = "Log in →"; }
      }
    });
  }
}

function dashboardSection() {
  const readiness = state.readiness || { score: 0, total: 0, items: [] };
  const billing = state.billing || state.selectedBusiness?.billing || {};
  const currentPlan = billing.plan || state.selectedBusiness?.plan || "basic";
  const activeBilling = ["active", "trialing"].includes(String(billing.status || "").toLowerCase());

  switch (state.tab) {
    case "leads":
      return `
        <section class="table-card">
          <h2 class="section-title">Leads</h2>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Course</th>
                  <th>Timing</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                ${(state.leads || []).map((lead) => `
                  <tr>
                    <td>${escapeHtml(lead.name || lead.profileName || "-")}</td>
                    <td>${escapeHtml(lead.phone || "-")}</td>
                    <td>${escapeHtml(lead.courseInterest || "-")}</td>
                    <td>${escapeHtml(lead.preferredTiming || "-")}</td>
                    <td><span class="pill">${escapeHtml(lead.status || "new")}</span></td>
                    <td>${escapeHtml(formatDate(lead.updatedAt))}</td>
                  </tr>
                `).join("") || `<tr><td colspan="6"><div class="empty">No leads captured yet.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
    case "chats":
      return `
        <section class="chat-card">
          <h2 class="section-title">Chat history</h2>
          <div class="chat-layout">
            <div class="chat-thread-list">
              ${(state.chats || []).map((thread) => `
                <button class="chat-thread ${state.activeChatId === thread.chatId ? "active" : ""}" data-chat-id="${escapeHtml(thread.chatId)}">
                  <strong>${escapeHtml(thread.contact?.name || thread.chatId)}</strong>
                  <div class="muted">${escapeHtml(thread.lastMessage?.text || "No messages yet")}</div>
                  <div class="muted">${escapeHtml(formatDate(thread.lastAt))}</div>
                </button>
              `).join("") || `<div class="empty">No chats stored for this institute yet.</div>`}
            </div>
            <div class="messages">
              ${(state.activeChatMessages || []).map((message) => `
                <div class="message ${message.role === "assistant" ? "assistant" : "user"}">
                  <div>${escapeHtml(message.text || "")}</div>
                  <div class="muted">${escapeHtml(formatDate(message.at))}</div>
                </div>
              `).join("") || `<div class="empty">Select a chat thread to inspect messages.</div>`}
            </div>
          </div>
        </section>
      `;
    case "bookings":
      return `
        <section class="table-card">
          <h2 class="section-title">Demo bookings</h2>
          <form id="booking-form" class="section">
            <div class="split">
              <div class="field">
                <label>Student name</label>
                <input class="input" name="name" placeholder="Student name" />
              </div>
              <div class="field">
                <label>Phone</label>
                <input class="input" name="phone" placeholder="+919876543210" required />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Course interest</label>
                <input class="input" name="courseInterest" placeholder="NEET" />
              </div>
              <div class="field">
                <label>Preferred timing</label>
                <input class="input" name="preferredTiming" placeholder="Tomorrow 5 PM" required />
              </div>
            </div>
            <div class="form-actions">
              <button class="button" type="submit">Add booking</button>
            </div>
          </form>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Course</th>
                  <th>Timing</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${(state.bookings || []).map((booking) => `
                  <tr>
                    <td>${escapeHtml(booking.name || "-")}</td>
                    <td>${escapeHtml(booking.phone || "-")}</td>
                    <td>${escapeHtml(booking.courseInterest || "-")}</td>
                    <td>${escapeHtml(booking.preferredTiming || "-")}</td>
                    <td><span class="pill">${escapeHtml(booking.status || "requested")}</span></td>
                  </tr>
                `).join("") || `<tr><td colspan="5"><div class="empty">No demo bookings yet.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
    case "billing":
      return `
        <section class="card">
          <div class="page-title" style="margin-bottom:6px;">Subscription</div>
          <div class="muted" style="margin-bottom:24px;">One plan. Everything included. Cancel anytime.</div>

          ${activeBilling ? `
            <div class="billing-active-banner">
              <div class="billing-active-icon">${renderCheckIcon({ size: 28, tone: "success" })}</div>
              <div>
                <div class="billing-active-title">Your subscription is active</div>
                <div class="muted" style="font-size:0.85rem;">Renews on ${escapeHtml(billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "—")}</div>
              </div>
              ${state.billingEnabled && billing.stripeCustomerId ? `<button class="ghost-button" id="billing-portal" style="margin-left:auto;">Manage</button>` : ""}
            </div>
          ` : ""}

          <div class="billing-plan-card">
            <div class="billing-plan-top">
              <div class="billing-plan-badge">swift-deploy.in AI Bot</div>
              <div class="billing-plan-name">All Platforms. All Features.</div>
              <div class="billing-plan-desc">Connect WhatsApp and Telegram. AI replies to every message 24/7 in any language. Unlimited conversations.</div>
            </div>
            <div class="billing-plan-pricing">
              <div class="billing-plan-price">
                <span class="billing-price-big">₹2,499</span><span class="billing-price-period">/month</span>
                <span class="billing-price-or">or</span>
                <span class="billing-price-big billing-price-usd">$39</span><span class="billing-price-period">/month</span>
              </div>
              ${renderFeatureList([
                "WhatsApp AI Bot",
                "Telegram AI Bot",
                "Unlimited AI replies",
                "Any language support",
                "24/7 always-on"
              ], "billing-plan-features")}
            </div>
            ${activeBilling ? `
              <div class="status-badge ok" style="width:fit-content;">Active — Bot is running</div>
            ` : `
              ${renderPaymentButtons()}
            `}
          </div>
          <button class="ghost-button" style="margin-top:12px;font-size:0.82rem;" id="billing-refresh">Refresh billing status</button>
        </section>
      `;
    case "team":
      return `
        <section class="card">
          <h2 class="section-title">Team Members</h2>
          <form id="invite-form" class="section">
            <div class="split">
              <div class="field">
                <label>Email address</label>
                <input class="input" name="email" type="email" placeholder="colleague@example.com" required />
              </div>
              <div class="field">
                <label>Role</label>
                <select class="select" name="role">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button class="button" type="submit">Send Invite</button>
            </div>
          </form>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Action</th></tr></thead>
              <tbody>
                ${(state.teamMembers || []).map((m) => `
                  <tr>
                    <td>${escapeHtml(m.email)}</td>
                    <td><span class="pill">${escapeHtml(m.role)}</span></td>
                    <td><span class="status-badge ${m.status === "active" ? "ok" : "warn"}">${escapeHtml(m.status)}</span></td>
                    <td>${escapeHtml(formatDate(m.createdAt))}</td>
                    <td><button class="danger-button remove-member" data-member-id="${escapeHtml(m.id)}">Remove</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="5"><div class="empty">No team members yet. Invite someone above.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
    case "apikeys":
      return `
        <section class="card">
          <h2 class="section-title">API Keys</h2>
          <p class="muted">Use API keys to connect external tools to your bot. Keep these secret.</p>
          <form id="apikey-form" class="section">
            <div class="split">
              <div class="field">
                <label>Key label</label>
                <input class="input" name="label" placeholder="e.g. Zapier integration" required />
              </div>
            </div>
            <div class="form-actions">
              <button class="button" type="submit">Generate Key</button>
            </div>
          </form>
          <div id="new-key-display"></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Label</th><th>Preview</th><th>Last Used</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>
                ${(state.apiKeys || []).map((k) => `
                  <tr>
                    <td>${escapeHtml(k.label)}</td>
                    <td><code>${escapeHtml(k.keyPreview)}</code></td>
                    <td>${escapeHtml(k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never")}</td>
                    <td>${escapeHtml(formatDate(k.createdAt))}</td>
                    <td><button class="danger-button revoke-key" data-key-id="${escapeHtml(k.id)}">Revoke</button></td>
                  </tr>
                `).join("") || `<tr><td colspan="5"><div class="empty">No API keys yet.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
    case "audit":
      return `
        <section class="card">
          <h2 class="section-title">Audit Log</h2>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Action</th><th>Details</th><th>Time</th></tr></thead>
              <tbody>
                ${(state.auditLogs || []).map((log) => `
                  <tr>
                    <td><code>${escapeHtml(log.action)}</code></td>
                    <td class="muted">${escapeHtml(JSON.stringify(log.details || {}))}</td>
                    <td>${escapeHtml(formatDate(log.createdAt))}</td>
                  </tr>
                `).join("") || `<tr><td colspan="3"><div class="empty">No audit events recorded yet.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
    case "analytics": {
      const adv = state.advancedAnalytics || {};
      const funnel = adv.funnel || [];
      const leadsPerDay = adv.leadsPerDay || [];
      const maxCount = Math.max(...leadsPerDay.map((d) => d.count), 1);
      return `
        <section class="card">
          <h2 class="section-title">Advanced Analytics</h2>
          <div class="section split">
            <div class="card">
              <h3 class="section-title">Conversion Funnel</h3>
              ${funnel.map((f) => `
                <div class="status-row">
                  <span>${escapeHtml(f.stage)}</span>
                  <span class="metric-value">${escapeHtml(String(f.count))}</span>
                </div>
              `).join("") || `<div class="empty">No funnel data yet.</div>`}
              <div class="muted section">Conversion rate: <strong>${escapeHtml(String(adv.conversionRate || 0))}%</strong></div>
            </div>
            <div class="card">
              <h3 class="section-title">Usage This Month</h3>
              ${state.usage ? `
                <div class="status-row"><span class="muted">Messages</span><span>${escapeHtml(String(state.usage.messages || 0))} / ${escapeHtml(String(state.usageLimits?.messagesPerMonth || "âˆž"))}</span></div>
                <div class="status-row"><span class="muted">Leads</span><span>${escapeHtml(String(state.usage.leads || 0))} / ${escapeHtml(String(state.usageLimits?.leadsMax || "âˆž"))}</span></div>
                <div class="usage-bar"><div class="usage-fill" style="width:${Math.min(100, Math.round(((state.usage.messages || 0) / (state.usageLimits?.messagesPerMonth || 1)) * 100))}%"></div></div>
              ` : `<div class="empty">Loading usage...</div>`}
            </div>
          </div>
          <div class="card section">
            <h3 class="section-title">Leads — Last 30 Days</h3>
            <div class="bar-chart">
              ${leadsPerDay.map((d) => `
                <div class="bar-col" title="${escapeHtml(d.date)}: ${escapeHtml(String(d.count))} leads">
                  <div class="bar" style="height:${Math.round((d.count / maxCount) * 80)}px"></div>
                  <div class="bar-label">${escapeHtml(d.date.slice(5))}</div>
                </div>
              `).join("") || `<div class="empty">No trend data yet.</div>`}
            </div>
          </div>
        </section>
      `;
    }
    case "admin":
      if (!state.adminStats) return `<section class="card"><div class="empty">Loading admin data...</div></section>`;
      return `
        <section class="card">
          <h2 class="section-title">Admin Dashboard</h2>
          <div class="metrics-grid">
            <div class="metric"><div class="muted">Total Users</div><div class="metric-value">${escapeHtml(String(state.adminStats.totalUsers || 0))}</div></div>
            <div class="metric"><div class="muted">New (7 days)</div><div class="metric-value">${escapeHtml(String(state.adminStats.newUsersLast7Days || 0))}</div></div>
            <div class="metric"><div class="muted">Total Businesses</div><div class="metric-value">${escapeHtml(String(state.adminStats.totalBusinesses || 0))}</div></div>
            <div class="metric"><div class="muted">Active Businesses</div><div class="metric-value">${escapeHtml(String(state.adminStats.activeBusinesses || 0))}</div></div>
            <div class="metric"><div class="muted">Total Leads</div><div class="metric-value">${escapeHtml(String(state.adminStats.totalLeads || 0))}</div></div>
            <div class="metric"><div class="muted">Leads (30 days)</div><div class="metric-value">${escapeHtml(String(state.adminStats.leadsLast30Days || 0))}</div></div>
          </div>
          <div class="section split">
            <div class="card">
              <h3 class="section-title">Plan Breakdown</h3>
              <div class="status-row"><span class="muted">Basic</span><span>${escapeHtml(String(state.adminStats.planBreakdown?.basic || 0))}</span></div>
              <div class="status-row"><span class="muted">Pro</span><span>${escapeHtml(String(state.adminStats.planBreakdown?.pro || 0))}</span></div>
              <div class="status-row"><span class="muted">Premium</span><span>${escapeHtml(String(state.adminStats.planBreakdown?.premium || 0))}</span></div>
            </div>
            <div class="card">
              <h3 class="section-title">All Businesses</h3>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Name</th><th>Plan</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    ${(state.adminBusinesses || []).slice(0, 20).map((b) => `
                      <tr>
                        <td>${escapeHtml(b.name)}</td>
                        <td><span class="pill">${escapeHtml(b.plan || "basic")}</span></td>
                        <td><span class="status-badge ${b.status === "active" ? "ok" : "warn"}">${escapeHtml(b.status || "active")}</span></td>
                        <td>
                          ${b.status === "suspended"
                            ? `<button class="ghost-button admin-unsuspend" data-biz-id="${escapeHtml(b.id)}">Restore</button>`
                            : `<button class="danger-button admin-suspend" data-biz-id="${escapeHtml(b.id)}">Suspend</button>`
                          }
                        </td>
                      </tr>
                    `).join("") || `<tr><td colspan="4"><div class="empty">No businesses yet.</div></td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      `;
    case "settings": {
      const waComingSoon = isWhatsAppComingSoon();
      const waConn = state.selectedBusiness?.whatsapp;
      const waIsLive = isWhatsAppReady(state.selectedBusiness);
      const waConfigured = isWhatsAppConfigured(state.selectedBusiness);
      if (waComingSoon) {
        return renderDisabledPlatformSurface("section", "card", `
          <div class="settings-wa-header">
            <div class="settings-wa-icon">
              <svg width="28" height="28" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
            </div>
            <div>
              <div class="settings-wa-title">Connect WhatsApp</div>
              <div class="muted" style="font-size:0.85rem;">WhatsApp onboarding is temporarily paused while we finish the rollout.</div>
            </div>
            <div class="platform-card-badge badge--coming-soon" style="margin-left:auto;">
              Coming soon
            </div>
          </div>

          <div class="platform-connected-info" style="margin:18px 0;">
            <div class="pci-row"><span>Status</span><strong style="color:#f5c451;">Temporarily unavailable</strong></div>
            <div class="pci-row"><span>Available now</span><strong>Telegram bot setup</strong></div>
          </div>

          <div class="settings-wa-steps">
            <div class="pc-step"><span class="pc-step-n">1</span>WhatsApp setup is disabled across the app for now.</div>
            <div class="pc-step"><span class="pc-step-n">2</span>The channel stays visible so your team still sees it in the roadmap.</div>
            <div class="pc-step"><span class="pc-step-n">3</span>Use Telegram for live bot launches until WhatsApp returns.</div>
          </div>
        `);
      }
      return `
        <section class="card">
          <div class="settings-wa-header">
            <div class="settings-wa-icon">
              <svg width="28" height="28" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
            </div>
            <div>
              <div class="settings-wa-title">Connect WhatsApp</div>
              <div class="muted" style="font-size:0.85rem;">Connect your own Meta WhatsApp app with verified credentials and webhook setup details</div>
            </div>
            <div class="platform-card-badge ${waIsLive ? "badge--live" : waConfigured ? "badge--warn" : "badge--idle"}" style="margin-left:auto;">
              ${waIsLive ? "â— Live" : waConfigured ? "â—‹ Connected" : "â—‹ Not connected"}
            </div>
          </div>

          ${waConfigured ? `
            <div class="platform-connected-info" style="margin:18px 0;">
              <div class="pci-row"><span>Phone Number</span><strong>${escapeHtml(waConn.displayPhoneNumber || waConn.phoneNumberId || "Connected")}</strong></div>
              <div class="pci-row"><span>Status</span><strong style="color:${waIsLive ? "#25d366" : "#f5c451"};">${waIsLive ? "Active — AI replying to messages" : "Connected — complete Meta webhook verification"}</strong></div>
            </div>
          ` : ""}

          <form id="settings-form" class="section">
            <div class="settings-wa-steps" style="margin-bottom:20px;">
              <div class="pc-step"><span class="pc-step-n">1</span>Go to <strong>Meta for Developers</strong> → Create a WhatsApp app</div>
              <div class="pc-step"><span class="pc-step-n">2</span>Copy your <strong>Phone Number ID</strong>, <strong>Access Token</strong>, and <strong>App Secret</strong></div>
              <div class="pc-step"><span class="pc-step-n">3</span>Paste them below, then finish the Meta webhook using the callback URL and verify token shown here</div>
            </div>
            <div class="split">
              <div class="field">
                <label>Your WhatsApp number</label>
                <input class="input" name="whatsappDisplayPhoneNumber" placeholder="+91 98765 43210" value="${escapeHtml(waConn?.displayPhoneNumber || "")}" />
                <small>The number users will message</small>
              </div>
              <div class="field">
                <label>Phone Number ID</label>
                <input class="input" name="whatsappPhoneNumberId" placeholder="From Meta app dashboard" value="${escapeHtml(waConn?.phoneNumberId || "")}" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Access Token</label>
                <input class="input" name="whatsappAccessToken" placeholder="${escapeHtml(waConn?.accessTokenMask || "EAA...")}" value="" />
                <small>${waConn?.accessTokenConfigured ? "Leave blank to keep the saved token, or paste a new permanent Meta token." : "Permanent token from your Meta app."}</small>
              </div>
              <div class="field">
                <label>App Secret</label>
                <input class="input" name="whatsappAppSecret" placeholder="${escapeHtml(waConn?.appSecretMask || "Meta App Secret")}" value="" />
                <small>${waConn?.appSecretConfigured ? "Leave blank to keep the saved app secret, or paste a new one." : "Required when each customer uses their own Meta app."}</small>
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Business Account ID <span class="muted">(optional)</span></label>
                <input class="input" name="whatsappBusinessAccountId" placeholder="From Meta Business Suite" value="${escapeHtml(waConn?.businessAccountId || "")}" />
              </div>
              <div class="field">
                <label>Callback URL</label>
                <input class="input" value="${escapeHtml(waConn?.webhookUrl || "")}" readonly />
                <small>Paste this into your Meta webhook callback URL field.</small>
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Verify Token</label>
                <input class="input" value="${escapeHtml(waConn?.webhookVerifyToken || "")}" readonly />
                <small>Paste this exact token into Meta during webhook verification.</small>
              </div>
              <div class="field">
                <label>Webhook Status</label>
                <input class="input" value="${escapeHtml(waConn?.webhookVerifiedAt ? `Verified at ${formatDate(waConn.webhookVerifiedAt)}` : "Waiting for Meta webhook verification")}" readonly />
                <small>After Meta verifies the webhook, this updates automatically.</small>
              </div>
            </div>
            <input type="hidden" name="whatsappProvider" value="meta" />
            <div class="form-actions">
              <button class="button" type="submit">${waConfigured ? "Update WhatsApp" : "Connect WhatsApp"}</button>
              ${waConfigured ? `<button class="ghost-button" type="button" id="settings-wa-disconnect">Disconnect</button>` : ""}
            </div>
          </form>
        </section>
      `;
    }
    default: {
      const tg = state.selectedBusiness?.telegram;
      const tgConnected = isTelegramConnected(state.selectedBusiness);
      const waComingSoon = isWhatsAppComingSoon();
      const waConfigured = isWhatsAppConfigured(state.selectedBusiness);
      const waReady = isWhatsAppReady(state.selectedBusiness);
      const waConnected = waComingSoon ? false : waReady;
      const totalChats = state.analytics?.totalChats || 0;
      const totalLeads = state.analytics?.totalLeads || 0;
      const qualifiedLeads = state.analytics?.qualifiedLeads || 0;
      const demoBooked = state.analytics?.demoBooked || 0;
      const totalPlatformSlots = waComingSoon ? 1 : 2;
      const activeBots = (tgConnected ? 1 : 0) + (waComingSoon ? 0 : waReady ? 1 : 0);
      const anyLive = tgConnected || (!waComingSoon && waReady);
      const bannerStatusLabel = waComingSoon && tgConnected
        ? "Telegram live"
        : anyLive
          ? "All systems live"
          : "No platform connected";
      const firstName = escapeHtml(state.user?.name?.split(" ")[0] || "there");
      const bizName = escapeHtml(state.selectedBusiness?.name || "");
      return `
        <div class="dash-banner">
          <div class="dash-banner-grid-bg"></div>
          <div class="dash-banner-inner">
            <div class="dash-banner-top">
              <div class="dash-banner-left">
                <div class="dash-banner-eyebrow">
                  <span class="dash-banner-dot ${anyLive ? "dash-banner-dot--live" : "dash-banner-dot--off"}"></span>
                  ${bannerStatusLabel}
                </div>
                <h1 class="dash-banner-title">Welcome back, <span class="dash-banner-name">${firstName}</span></h1>
                ${bizName ? `<div class="dash-banner-biz">${bizName}</div>` : ""}
              </div>
              <div class="dash-banner-right">
                <div class="dash-plat-badge ${waComingSoon ? "dash-plat-badge--coming-soon" : waReady ? "dash-plat-badge--wa-live" : waConfigured ? "dash-plat-badge--pending" : "dash-plat-badge--off"}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill="currentColor"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438C8.34 21.475 10.11 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
                  <span class="dash-plat-name">WhatsApp</span>
                  <span class="dash-plat-status">${waComingSoon ? "Coming soon" : waReady ? "Live" : waConfigured ? "Pending" : "Off"}</span>
                </div>
                <div class="dash-plat-badge ${tgConnected ? "dash-plat-badge--tg-live" : "dash-plat-badge--off"}">
                  <svg width="16" height="16" viewBox="0 0 52 52" fill="none"><path d="M38.94 14.29L33.6 38.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L12.37 29.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="currentColor"/></svg>
                  <span class="dash-plat-name">Telegram</span>
                  <span class="dash-plat-status">${tgConnected ? "Live" : "Off"}</span>
                </div>
              </div>
            </div>

            <div class="dash-stats-row">
              <div class="dash-stat-card">
                <div class="dash-stat-card-icon dash-stat-icon--chats">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="dash-stat-card-val">${totalChats}</div>
                <div class="dash-stat-card-lbl">Conversations</div>
              </div>
              <div class="dash-stat-card">
                <div class="dash-stat-card-icon dash-stat-icon--leads">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <div class="dash-stat-card-val">${totalLeads}</div>
                <div class="dash-stat-card-lbl">Total Leads</div>
              </div>
              <div class="dash-stat-card">
                <div class="dash-stat-card-icon dash-stat-icon--qualified">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="dash-stat-card-val">${qualifiedLeads}</div>
                <div class="dash-stat-card-lbl">Qualified</div>
              </div>
              <div class="dash-stat-card">
                <div class="dash-stat-card-icon dash-stat-icon--demos">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <div class="dash-stat-card-val">${demoBooked}</div>
                <div class="dash-stat-card-lbl">Demos Booked</div>
              </div>
              <div class="dash-stat-card">
                <div class="dash-stat-card-icon dash-stat-icon--bots">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M12 11V7M8 7h8M9 15h.01M15 15h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.8"/></svg>
                </div>
                <div class="dash-stat-card-val">${activeBots}<span class="dash-stat-card-denom">/${totalPlatformSlots}</span></div>
                <div class="dash-stat-card-lbl">Active Bots</div>
              </div>
            </div>
          </div>
        </div>

        <div class="platform-cards-grid">

          <!-- WhatsApp Card -->
          ${waComingSoon
            ? renderDisabledPlatformSurface("div", "pcard pcard--wa-disabled", `
                <div class="pcard-glow pcard-glow--wa"></div>
                <div class="pcard-top">
                  <div class="pcard-icon pcard-icon--wa">
                    <svg width="26" height="26" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
                  </div>
                  <div class="pcard-title-wrap">
                    <div class="pcard-platform">WhatsApp</div>
                    <div class="pcard-status pcard-status--coming-soon">
                      <span class="pcard-dot"></span>Coming soon
                    </div>
                  </div>
                </div>
                <div class="pcard-body">
                  <div class="pcard-info-rows">
                    <div class="pcard-info-row"><span>Status</span><strong style="color:#f5c451;">Temporarily unavailable</strong></div>
                    <div class="pcard-info-row"><span>Available now</span><strong style="color:#2aabee;">Telegram bot</strong></div>
                  </div>
                  <p class="pcard-desc">WhatsApp stays visible in the dashboard, but setup and management are paused until the channel is ready to launch again.</p>
                </div>
              `)
            : `
              <div class="pcard ${waConnected ? "pcard--live pcard--wa-live" : "pcard--wa-idle"}">
                <div class="pcard-glow pcard-glow--wa"></div>
                <div class="pcard-top">
                  <div class="pcard-icon pcard-icon--wa">
                    <svg width="26" height="26" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
                  </div>
                  <div class="pcard-title-wrap">
                    <div class="pcard-platform">WhatsApp</div>
                    <div class="pcard-status ${waReady ? "pcard-status--live" : "pcard-status--idle"}">
                      <span class="pcard-dot"></span>${waReady ? "Live — AI replying" : waConfigured ? "Connected — finish webhook" : "Not connected"}
                    </div>
                  </div>
                </div>
                <div class="pcard-body">
                  ${waReady ? `
                    <div class="pcard-info-rows">
                      <div class="pcard-info-row"><span>Number</span><strong>${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || "Connected")}</strong></div>
                      <div class="pcard-info-row"><span>Replies</span><strong style="color:#25d366;">24/7 automated</strong></div>
                    </div>
                    <p class="pcard-desc">Your WhatsApp AI bot is live and replying to every message instantly. Share your number with users to start conversations.</p>
                    <button class="pcard-btn pcard-btn--danger" id="ov-wa-disconnect">Disconnect WhatsApp</button>
                  ` : waConfigured ? `
                    <div class="pcard-info-rows">
                      <div class="pcard-info-row"><span>Number</span><strong>${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || state.selectedBusiness?.whatsapp?.phoneNumberId || "Connected")}</strong></div>
                      <div class="pcard-info-row"><span>Status</span><strong style="color:#f5c451;">Webhook setup pending</strong></div>
                    </div>
                    <p class="pcard-desc">Your credentials are saved. Complete the Meta webhook in Settings using the callback URL and verify token, then replies will start automatically.</p>
                  ` : `
                    <p class="pcard-desc">Connect your WhatsApp Business number. Your AI bot will reply to every message automatically — any language, any time.</p>
                    <div class="pcard-steps">
                      <div class="pcard-step"><span class="pcard-step-n">1</span>Get your Meta WhatsApp API credentials</div>
                      <div class="pcard-step"><span class="pcard-step-n">2</span>Go to <strong>Settings</strong> and enter them</div>
                      <div class="pcard-step"><span class="pcard-step-n">3</span>Bot activates instantly — no waiting</div>
                    </div>
                    <button class="pcard-btn pcard-btn--wa" id="ov-wa-connect-btn">
                      <svg width="16" height="16" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm7.24 20.313c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4.175-.812.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012s-.688.1-1.05.487c-.362.387-1.387 1.35-1.387 3.3s1.425 3.837 1.625 4.1c.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
                      Connect WhatsApp
                    </button>
                  `}
                </div>
              </div>
            `}

          <!-- Telegram Card -->
          <div class="pcard ${tgConnected ? "pcard--live pcard--tg-live" : "pcard--tg-idle"}">
            <div class="pcard-glow pcard-glow--tg"></div>
            <div class="pcard-top">
              <div class="pcard-icon pcard-icon--tg">
                <svg width="26" height="26" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="14" fill="#229ED9"/><path d="M38.94 14.29L33.6 38.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L12.37 29.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
              </div>
              <div class="pcard-title-wrap">
                <div class="pcard-platform">Telegram</div>
                <div class="pcard-status ${tgConnected ? "pcard-status--live pcard-status--tg" : "pcard-status--idle"}">
                  <span class="pcard-dot"></span>${tgConnected ? "Live — AI replying" : "Not connected"}
                </div>
              </div>
            </div>
            <div class="pcard-body">
              ${tgConnected ? `
                <div class="pcard-info-rows">
                  <div class="pcard-info-row"><span>Bot</span><strong>@${escapeHtml(tg.botUsername || "")}</strong></div>
                  <div class="pcard-info-row"><span>Replies</span><strong style="color:#2aabee;">24/7 automated</strong></div>
                </div>
                <p class="pcard-desc">Your Telegram AI bot is live. Share <strong>@${escapeHtml(tg.botUsername || "")}</strong> with your users — the AI handles every message instantly.</p>
                <button class="pcard-btn pcard-btn--danger" id="ov-tg-disconnect">Disconnect bot</button>
              ` : `
                <p class="pcard-desc">Paste your BotFather token to go live in under 60 seconds — no Meta approval, no waiting, no extra cost.</p>
                <div class="pcard-steps">
                  <div class="pcard-step"><span class="pcard-step-n">1</span>Open Telegram → search <strong>@BotFather</strong></div>
                  <div class="pcard-step"><span class="pcard-step-n">2</span>Send <code>/newbot</code> → follow the steps</div>
                  <div class="pcard-step"><span class="pcard-step-n">3</span>Paste the token below and go live</div>
                </div>
                <div id="ov-tg-error" class="form-error" style="display:none;margin-bottom:8px;"></div>
                <form id="ov-tg-form" style="display:flex;gap:8px;margin-top:4px;">
                  <input class="input" id="ov-tg-token" placeholder="Paste BotFather token..." style="flex:1;font-size:0.82rem;" required />
                  <button class="platform-card-btn platform-card-btn--tg" type="submit">Connect</button>
                </form>
              `}
            </div>
          </div>

        </div>

        <div class="section split" style="margin-top:20px;">
          <div class="card">
            <h3 class="section-title">Recent chats</h3>
            ${(state.chats || []).slice(0, 5).map((chat) => `
              <div class="chat-thread">
                <strong>${escapeHtml(chat.contact?.name || chat.chatId)}</strong>
                <div class="muted">${escapeHtml(chat.lastMessage?.text || "No messages yet")}</div>
              </div>
            `).join("") || `<div class="empty">No chats yet. Connect a platform above to start.</div>`}
          </div>
          <div class="card">
            <h3 class="section-title">Recent leads</h3>
            ${(state.leads || []).slice(0, 5).map((lead) => `
              <div class="chat-thread">
                <strong>${escapeHtml(lead.name || lead.phone)}</strong>
                <div class="muted">${escapeHtml(lead.courseInterest || "No course captured")}</div>
                <div class="pill">${escapeHtml(lead.status || "new")}</div>
              </div>
            `).join("") || `<div class="empty">No leads yet.</div>`}
          </div>
        </div>
      `;
    }
  }
}

function needsOnboarding() {
  return false;
}

function renderOnboarding() {
  const step = state.onboardingStep || 1;
  const biz = state.selectedBusiness;
  const bizName = escapeHtml(biz?.name || "your institute");

  const steps = [
    { num: 1, label: "Setup",   desc: "Institute profile"  },
    { num: 2, label: "Courses", desc: "Programs & batches" },
    { num: 3, label: "FAQs",    desc: "Common questions"   },
    { num: 4, label: "Live",    desc: "Bot is active"      }
  ];

  const stepper = steps.map((s, i) => `
    <div class="ob2-step ${step === s.num ? "ob2-step--active" : step > s.num ? "ob2-step--done" : "ob2-step--pending"}">
      <div class="ob2-step-circle">
        ${step > s.num
          ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L5.5 10L11.5 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : s.num}
      </div>
      <div class="ob2-step-meta">
        <span class="ob2-step-label">${s.label}</span>
        <span class="ob2-step-desc">${s.desc}</span>
      </div>
      ${i < steps.length - 1 ? '<div class="ob2-step-connector"></div>' : ""}
    </div>
  `).join("");

  let panel = "";

  if (step === 1) {
    panel = `
      <div class="ob2-panel-head">
        <div class="ob2-badge">Step 1 of 3</div>
        <h2 class="ob2-title">Set up your institute profile</h2>
        <p class="ob2-sub">This is the identity your AI bot will use when talking to students on WhatsApp. Make it specific — the more context you give, the smarter the bot replies.</p>
      </div>
      <form id="ob-form-1" class="ob2-form">
        <div class="ob2-field">
          <label class="ob2-label">Institute name <span class="ob2-req">*</span></label>
          <input class="ob2-input" name="name" value="${escapeHtml(biz?.name || "")}" placeholder="e.g. Apex Coaching Centre" required autocomplete="off" />
          <span class="ob2-hint">This is how your bot will introduce your institute to every student.</span>
        </div>
        <div class="ob2-field">
          <label class="ob2-label">What do you offer? <span class="ob2-hint-inline">optional</span></label>
          <textarea class="ob2-textarea" name="description" rows="2" placeholder="e.g. Premium JEE & NEET coaching for Class 9—12. 15 years of results, expert faculty, small batches.">${escapeHtml(biz?.description || "")}</textarea>
          <span class="ob2-hint">Students see this when they ask "What is this institute about?"</span>
        </div>
        <div class="ob2-field">
          <label class="ob2-label">Bot personality <span class="ob2-hint-inline">how should it talk?</span></label>
          <textarea class="ob2-textarea" name="aiPrompt" rows="3" placeholder="e.g. You are a warm and professional admissions counselor. Answer clearly, keep replies concise, and always guide students toward booking a free demo class.">${escapeHtml(biz?.aiPrompt || "")}</textarea>
          <span class="ob2-hint">Think of this as the tone of voice — friendly, formal, Hinglish-mix, etc.</span>
        </div>
        <div class="ob2-field">
          <label class="ob2-label">Welcome message <span class="ob2-hint-inline">first thing bot says</span></label>
          <input class="ob2-input" name="welcomeMessage" value="${escapeHtml(biz?.welcomeMessage || "")}" placeholder="e.g. 👋 Hi! Welcome to Apex Coaching. I'm your AI admissions assistant. How can I help you today?" />
          <span class="ob2-hint">Sent the moment a student first messages your WhatsApp number.</span>
        </div>
        <div class="ob2-actions">
          <button class="ob2-btn-primary" type="submit">
            Continue to Courses
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </form>
    `;
  } else if (step === 2) {
    panel = `
      <div class="ob2-panel-head">
        <div class="ob2-badge">Step 2 of 3</div>
        <h2 class="ob2-title">Add your courses & batches</h2>
        <p class="ob2-sub">When a student asks "What courses do you offer?" or "What is the fee for JEE?", your bot will answer directly from this list. The more detail you add, the better it answers.</p>
      </div>
      <form id="ob-form-2" class="ob2-form">
        <div class="ob2-field">
          <label class="ob2-label">Course catalog</label>
          <div class="ob2-format-pill">Format: <code>Course Name | Timings | Fee | Keywords | Description</code></div>
          <textarea class="ob2-textarea ob2-textarea--code" name="courseText" rows="8" placeholder="JEE Main & Advanced | Mon Wed Fri 5—7 pm | ₹8,000/month | jee,iit,engineering | Comprehensive 2-year JEE prep with test series
NEET | Tue Thu Sat 4—6 pm | ₹7,500/month | neet,medical,biology | NEET coaching for Class 11—12 with biology focus
Foundation (Class 8—10) | Daily 4—5 pm | ₹5,000/month | foundation,school,cbse | School subject coaching with competitive exam base">${escapeHtml(serializeCourses(biz?.courseItems || []))}</textarea>
          <span class="ob2-hint">One course per line. Keywords help the bot match student questions to the right course.</span>
        </div>
        <div class="ob2-actions">
          <button class="ob2-btn-ghost" type="button" id="ob-back-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Back
          </button>
          <button class="ob2-btn-primary" type="submit">
            Continue to FAQs
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </form>
    `;
  } else if (step === 3) {
    panel = `
      <div class="ob2-panel-head">
        <div class="ob2-badge">Step 3 of 3</div>
        <h2 class="ob2-title">Add your FAQs</h2>
        <p class="ob2-sub">Every institute gets the same 20 questions asked 100 times. Add them once — your bot handles them forever, at any hour, in any language.</p>
      </div>
      <form id="ob-form-3" class="ob2-form">
        <div class="ob2-field">
          <label class="ob2-label">Frequently asked questions</label>
          <div class="ob2-format-pill">Format: <code>Question | Answer</code></div>
          <textarea class="ob2-textarea ob2-textarea--code" name="faqText" rows="9" placeholder="What is the fee for JEE? | The JEE batch fee is ₹8,000/month with flexible EMI options available.
Do you offer demo classes? | Yes! We offer a free 1-hour demo class. Just share your name and preferred timing.
What are the batch timings? | Morning 6—8 am, Afternoon 2—4 pm, Evening 5—7 pm batches available.
Is there a hostel facility? | Yes, hostel accommodation is available for outstation students.
How many students per batch? | We maintain small batches of max 20 students for personal attention.
What is the success rate? | Our students have a 94% selection rate in JEE & NEET over the last 5 years.">${escapeHtml(serializeFaqs(biz?.faqItems || []))}</textarea>
          <span class="ob2-hint">One FAQ per line. These are answered instantly — no human needed, 24/7.</span>
        </div>
        <div class="ob2-actions">
          <button class="ob2-btn-ghost" type="button" id="ob-back-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Back
          </button>
          <button class="ob2-btn-primary" type="submit">
            Launch my AI bot
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </form>
    `;
  } else {
    panel = `
      <div class="ob2-done">
        <div class="ob2-done-glow"></div>
        <div class="ob2-done-check">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#22c55e" opacity="0.15"/><path d="M9 16.5L13.5 21L23 11" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h2 class="ob2-done-title">${bizName} is live on WhatsApp</h2>
        <p class="ob2-done-sub">Your AI admissions bot is now active. Students who message your WhatsApp number will get instant, intelligent replies — 24 hours a day, in any language.</p>

        <div class="ob2-live-grid">
          <div class="ob2-live-card">
            <div class="ob2-live-icon">🤖</div>
            <div class="ob2-live-card-body">
              <div class="ob2-live-card-title">AI Bot</div>
              <div class="ob2-live-card-val ob2-green">Active</div>
            </div>
          </div>
          <div class="ob2-live-card">
            <div class="ob2-live-icon">📲</div>
            <div class="ob2-live-card-body">
              <div class="ob2-live-card-title">WhatsApp</div>
              <div class="ob2-live-card-val ob2-green">Connected</div>
            </div>
          </div>
          <div class="ob2-live-card">
            <div class="ob2-live-icon">🎯</div>
            <div class="ob2-live-card-body">
              <div class="ob2-live-card-title">Lead Capture</div>
              <div class="ob2-live-card-val ob2-green">On</div>
            </div>
          </div>
          <div class="ob2-live-card">
            <div class="ob2-live-icon">📅</div>
            <div class="ob2-live-card-body">
              <div class="ob2-live-card-title">Demo Booking</div>
              <div class="ob2-live-card-val ob2-green">On</div>
            </div>
          </div>
        </div>

        <div class="ob2-next-steps">
          <div class="ob2-next-title">What's next</div>
          <div class="ob2-next-item">
            <span class="ob2-next-num">1</span>
            <span>Share your WhatsApp number with students — the bot handles all replies automatically.</span>
          </div>
          <div class="ob2-next-item">
            <span class="ob2-next-num">2</span>
            <span>Monitor leads, bookings, and chats from your dashboard in real time.</span>
          </div>
          <div class="ob2-next-item">
            <span class="ob2-next-num">3</span>
            <span>Refine courses, FAQs, and the AI tone anytime from <strong>Settings</strong>.</span>
          </div>
        </div>

        <button class="ob2-btn-primary ob2-btn-full" id="ob-goto-dashboard">
          Go to dashboard
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;
  }

  app.innerHTML = `
    <div class="ob2-shell">
      <aside class="ob2-sidebar">
        <div class="ob2-sidebar-brand">
          <img src="/logo.svg?v=crab-mark-3" width="28" height="28" class="logo-img" alt="swift-deploy.in" />
          <span class="logo-name">swift-deploy.in</span>
        </div>
        <div class="ob2-sidebar-intro">
          <div class="ob2-sidebar-title">Set up your AI bot</div>
          <div class="ob2-sidebar-sub">Takes about 3 minutes. No technical knowledge needed.</div>
        </div>
        <nav class="ob2-stepper">${stepper}</nav>
        <div class="ob2-sidebar-footer">
          <div class="ob2-trust-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.8 5H13L9.6 7.6L10.9 12L7 9.4L3.1 12L4.4 7.6L1 5H5.2L7 1Z" fill="#6366f1"/></svg>
            <span>Used by 500+ institutes</span>
          </div>
          <div class="ob2-trust-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4 1.5 1.5 4 1.5 7S4 12.5 7 12.5 12.5 10 12.5 7 10 1.5 7 1.5zm0 4v3M7 10h.01" stroke="#6366f1" stroke-width="1.4" stroke-linecap="round"/></svg>
            <span>24/7 AI support in 30+ languages</span>
          </div>
        </div>
      </aside>
      <main class="ob2-main">
        <div class="ob2-panel">
          ${panel}
        </div>
      </main>
    </div>
  `;

  document.querySelector("#ob-form-1")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".ob2-btn-primary");
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="ob2-spinner"></span> Saving…';
    try {
      const data = formToObject(e.target);
      await api(`/api/businesses/${encodeURIComponent(biz.id)}`, { method: "PATCH", body: data });
      await loadBootstrap(biz.id);
      state.onboardingStep = 2;
      renderOnboarding();
    } catch (err) { alert(err.message); btn.disabled = false; btn.innerHTML = orig; }
  });

  document.querySelector("#ob-form-2")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".ob2-btn-primary");
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="ob2-spinner"></span> Saving…';
    try {
      const data = formToObject(e.target);
      const courseItems = parseCourseText(data.courseText);
      await api(`/api/businesses/${encodeURIComponent(biz.id)}`, { method: "PATCH", body: { courseItems } });
      await loadBootstrap(biz.id);
      state.onboardingStep = 3;
      renderOnboarding();
    } catch (err) { alert(err.message); btn.disabled = false; btn.innerHTML = orig; }
  });
  document.querySelector("#ob-back-2")?.addEventListener("click", () => { state.onboardingStep = 1; renderOnboarding(); });

  document.querySelector("#ob-form-3")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".ob2-btn-primary");
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="ob2-spinner"></span> Launching…';
    try {
      const data = formToObject(e.target);
      const faqItems = parseFaqText(data.faqText);
      await api(`/api/businesses/${encodeURIComponent(biz.id)}`, { method: "PATCH", body: { faqItems } });
      await loadBootstrap(biz.id);
      state.onboardingStep = 4;
      state.onboardingDone = true;
      renderOnboarding();
    } catch (err) { alert(err.message); btn.disabled = false; btn.innerHTML = orig; }
  });
  document.querySelector("#ob-back-3")?.addEventListener("click", () => { state.onboardingStep = 2; renderOnboarding(); });

  document.querySelector("#ob-goto-dashboard")?.addEventListener("click", () => {
    state.onboardingStep = 0;
    state.showOnboarding = false;
    state.onboardingDone = true;
    render();
  });
}

function buildDisconnectModal() {
  if (!state.showDisconnectModal) return "";
  const isPlatformTg = state.disconnectPlatform === "telegram";
  const platformLabel = isPlatformTg ? "Telegram" : "WhatsApp";
  const platformDetail = isPlatformTg
    ? (state.selectedBusiness?.telegram?.botUsername ? "@" + state.selectedBusiness.telegram.botUsername : "your Telegram bot")
    : (state.selectedBusiness?.whatsapp?.displayPhoneNumber || "your WhatsApp number");
  return `
    <div class="disconnect-overlay" id="disconnect-overlay">
      <div class="disconnect-modal">
        <div class="disconnect-modal-icon">\u26A0\uFE0F</div>
        <div class="disconnect-modal-badge">Disconnect ${escapeHtml(platformLabel)}</div>
        <h2 class="disconnect-modal-title">Stop ${escapeHtml(platformLabel)} bot?</h2>
        <div class="disconnect-modal-detail">
          <span class="disconnect-platform-name">${escapeHtml(platformDetail)}</span>
        </div>
        <div class="disconnect-modal-warning">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 5v4M8 10.5h.01" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>
          Your bot will stop replying immediately. Conversation history is kept. To reconnect, complete the full setup again.
        </div>
        <div class="disconnect-modal-confirm-wrap">
          <label class="disconnect-modal-label">Type <strong>DISCONNECT</strong> to confirm</label>
          <input class="input disconnect-confirm-input" id="disconnect-confirm-input" placeholder="DISCONNECT" autocomplete="off" spellcheck="false" />
        </div>
        <div class="disconnect-modal-actions">
          <button class="ghost-button disconnect-cancel" id="disconnect-cancel">Cancel</button>
          <button class="danger-button disconnect-confirm-btn" id="disconnect-confirm-btn" disabled>Disconnect</button>
        </div>
      </div>
    </div>`;
}

function renderDashboard() {
  const tgLive = isTelegramConnected(state.selectedBusiness);
  const waConfigured = isWhatsAppConfigured(state.selectedBusiness);
  const waLive = isWhatsAppReady(state.selectedBusiness);
  const anyLive = tgLive || waLive;

  app.innerHTML = `
    ${state.showBotLivePopup && anyLive ? `
      <div class="bot-live-overlay" id="bot-live-overlay">
        <div class="bot-live-popup">
          <div class="bot-live-popup-icon">🚀</div>
          <h2>Your bot is live!</h2>
          <p>${tgLive ? `<strong>@${escapeHtml(state.selectedBusiness?.telegram?.botUsername || "")}</strong> is now active on Telegram.` : ""}
             ${waLive ? `Your WhatsApp number <strong>${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || "")}</strong> is now active.` : ""}</p>
          <p class="bot-live-popup-sub">Your AI bot is running 24/7. Share your bot/number with users — it replies instantly to every message.</p>
          <button class="button" id="bot-live-close" style="width:100%;justify-content:center;">Go to Dashboard →</button>
        </div>
      </div>
    ` : ""}
    ${buildDisconnectModal()}
    <main class="app-shell">
      <div class="shell">
        <div class="app-topbar">
          <div class="topbar-left">
            <div class="logo">
              <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </div>
          </div>
          <div class="inline-actions">
            <button class="ghost-button" id="refresh-dashboard">Refresh</button>
            <button class="danger-button" id="logout-button">Log out</button>
          </div>
        </div>

        <section class="dashboard-grid">
          <aside class="sidebar">
            <button class="tab-button ${state.tab === "overview" ? "active" : ""}" data-tab="overview">🏠 Dashboard</button>
            <button class="tab-button ${state.tab === "billing" ? "active" : ""}" data-tab="billing">💳 Billing</button>
            ${state.user?.isAdmin ? `<div class="sidebar-section-label">Admin</div><button class="tab-button ${state.tab === "admin" ? "active" : ""}" data-tab="admin">🛡️ Admin</button>` : ""}
          </aside>

          <div class="main-column">
            ${dashboardSection()}
          </div>
        </section>
      </div>
    </main>
  `;

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = normalizeTab(button.dataset.tab);
      syncDashboardUrl();
      render();
    });
  });

  const switcher = document.querySelector("#business-switcher");
  if (switcher) {
    switcher.addEventListener("change", async (event) => {
      await loadBootstrap(event.target.value);
      render();
    });
  }

  document.querySelector("#bot-live-close")?.addEventListener("click", () => {
    state.showBotLivePopup = false;
    render();
  });

  // Disconnect modal
  document.querySelector("#disconnect-cancel")?.addEventListener("click", () => {
    state.showDisconnectModal = false;
    state.disconnectPlatform = null;
    render();
  });

  document.querySelector("#disconnect-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "disconnect-overlay") {
      state.showDisconnectModal = false;
      state.disconnectPlatform = null;
      render();
    }
  });

  document.querySelector("#disconnect-confirm-input")?.addEventListener("input", (e) => {
    const btn = document.querySelector("#disconnect-confirm-btn");
    if (btn) btn.disabled = e.target.value.trim().toUpperCase() !== "DISCONNECT";
  });

  document.querySelector("#disconnect-confirm-btn")?.addEventListener("click", async () => {
    const confirmInput = document.querySelector("#disconnect-confirm-input");
    if (confirmInput?.value?.trim()?.toUpperCase() !== "DISCONNECT") return;
    const btn = document.querySelector("#disconnect-confirm-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Disconnecting..."; }
    const platform = state.disconnectPlatform;
    try {
      if (platform === "telegram") {
        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, { method: "DELETE" });
      } else {
        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/whatsapp`, { method: "DELETE" });
      }
      await loadBootstrap(state.selectedBusiness.id);
      state.showDisconnectModal = false;
      state.disconnectPlatform = null;
      state.billingActivated = false;
      render();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Disconnect"; }
      const errEl = document.createElement("div");
      errEl.className = "auth-form-error";
      errEl.style.cssText = "margin-top:10px;text-align:center;";
      errEl.textContent = err.message;
      document.querySelector(".disconnect-modal-actions")?.after(errEl);
    }
  });

  document.querySelector("#bot-live-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "bot-live-overlay") { state.showBotLivePopup = false; render(); }
  });

  document.querySelector("#refresh-dashboard")?.addEventListener("click", async () => {
    await loadBootstrap(state.selectedBusiness?.id || "");
    state.billingNotice = null;
    render();
  });

  document.querySelector("#logout-button")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    state.userBusinesses = [];
    state.selectedBusiness = null;
    state.analytics = null;
    state.readiness = { score: 0, total: 0, items: [] };
    state.billing = null;
    state.billingEnabled = false;
    state.billingProviders = normalizeBillingProviders();
    state.billingNotice = null;
    state.leads = [];
    state.bookings = [];
    state.chats = [];
    state.activeChatId = "";
    state.activeChatMessages = [];
    render();
  });

  document.querySelector("#create-business")?.addEventListener("click", async () => {
    const name = window.prompt("Name for the new institute workspace:");
    if (!name) {
      return;
    }
    try {
      await api("/api/businesses", {
        method: "POST",
        body: { name }
      });
      await loadBootstrap();
      render();
    } catch (error) {
      alert(error.message);
    }
  });

  // Overview tab — WhatsApp connect button
  document.querySelector("#ov-wa-connect-btn")?.addEventListener("click", () => {
    state.tab = "settings";
    render();
    setTimeout(() => {
      document.querySelector("#ov-wa-connect-btn")?.scrollIntoView?.({ behavior: "smooth" });
    }, 100);
  });

  // Overview tab — Telegram connect form
  document.querySelector("#ov-tg-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.querySelector("#ov-tg-token")?.value?.trim();
    if (!token) return;
    const btn = e.target.querySelector("button[type=submit]");
    const errEl = document.querySelector("#ov-tg-error");
    if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
    if (errEl) errEl.style.display = "none";
    try {
      await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, {
        method: "POST",
        body: { token }
      });
      await loadBootstrap(state.selectedBusiness.id);
      state.showBotLivePopup = true;
      render();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
      if (btn) { btn.disabled = false; btn.textContent = "Connect"; }
    }
  });

  document.querySelector("#ov-tg-disconnect")?.addEventListener("click", () => {
    state.disconnectPlatform = "telegram";
    state.showDisconnectModal = true;
    render();
  });

  document.querySelector("#ov-wa-disconnect")?.addEventListener("click", () => {
    state.disconnectPlatform = "whatsapp";
    state.showDisconnectModal = true;
    render();
  });

  document.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openChat(button.dataset.chatId);
    });
  });

  const bookingForm = document.querySelector("#booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/bookings`, {
          method: "POST",
          body: formToObject(bookingForm)
        });
        state.tab = "bookings";
        await loadBootstrap(state.selectedBusiness.id);
        syncDashboardUrl();
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const settingsForm = document.querySelector("#settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = formToObject(settingsForm);
        const result = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/whatsapp`, {
          method: "POST",
          body: payload
        });
        await loadBootstrap(state.selectedBusiness.id);
        const waNowLive = isWhatsAppReady(state.selectedBusiness);
        if (waNowLive) state.showBotLivePopup = true;
        if (!waNowLive) showWhatsAppSetupAlert(result?.setup);
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  document.querySelector("#settings-wa-disconnect")?.addEventListener("click", () => {
    state.disconnectPlatform = "whatsapp";
    state.showDisconnectModal = true;
    render();
  });

  // Team invite
  document.querySelector("#invite-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formToObject(e.target);
    try {
      await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/team`, { method: "POST", body: data });
      await loadBootstrap(state.selectedBusiness.id);
      render();
    } catch (error) { alert(error.message); }
  });

  document.querySelectorAll(".remove-member").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this team member?")) return;
      try {
        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/team/${encodeURIComponent(btn.dataset.memberId)}`, { method: "DELETE" });
        await loadBootstrap(state.selectedBusiness.id);
        render();
      } catch (error) { alert(error.message); }
    });
  });

  // API Keys
  document.querySelector("#apikey-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formToObject(e.target);
    try {
      const result = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/api-keys`, { method: "POST", body: data });
      const display = document.querySelector("#new-key-display");
      if (display) display.innerHTML = `<div class="notice success">New key (copy now — shown once): <code>${escapeHtml(result.key)}</code></div>`;
      await loadBootstrap(state.selectedBusiness.id);
      render();
    } catch (error) { alert(error.message); }
  });

  document.querySelectorAll(".revoke-key").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Revoke this API key? It will stop working immediately.")) return;
      try {
        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/api-keys/${encodeURIComponent(btn.dataset.keyId)}`, { method: "DELETE" });
        await loadBootstrap(state.selectedBusiness.id);
        render();
      } catch (error) { alert(error.message); }
    });
  });

  // Admin actions
  document.querySelectorAll(".admin-suspend").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Suspend this business?")) return;
      try {
        await api(`/api/admin/businesses/${encodeURIComponent(btn.dataset.bizId)}/suspend`, { method: "POST" });
        await loadBootstrap(state.selectedBusiness.id);
        render();
      } catch (error) { alert(error.message); }
    });
  });

  document.querySelectorAll(".admin-unsuspend").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/admin/businesses/${encodeURIComponent(btn.dataset.bizId)}/unsuspend`, { method: "POST" });
        await loadBootstrap(state.selectedBusiness.id);
        render();
      } catch (error) { alert(error.message); }
    });
  });

  attachPaymentButtonHandlers();

  document.querySelector("#billing-portal")?.addEventListener("click", async () => {
    try {
      const payload = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/billing/portal`, {
        method: "POST"
      });
      if (payload.url) {
        window.location.href = payload.url;
      }
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector("#billing-refresh")?.addEventListener("click", async () => {
    await loadBootstrap(state.selectedBusiness?.id || "");
    state.billingNotice = null;
    render();
  });

  // Telegram settings form (inside Settings tab)
  document.querySelector("#tg-settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.querySelector("#tg-settings-token")?.value?.trim();
    if (!token) return;
    const btn = e.target.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, {
        method: "POST",
        body: { token }
      });
      await loadBootstrap(state.selectedBusiness.id);
      render();
    } catch (error) {
      alert(error.message);
      if (btn) btn.disabled = false;
    }
  });

  document.querySelector("#tg-disconnect-settings-btn")?.addEventListener("click", async () => {
    if (!confirm("Disconnect Telegram bot? Your bot will stop responding to messages.")) return;
    try {
      await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, { method: "DELETE" });
      await loadBootstrap(state.selectedBusiness.id);
      render();
    } catch (error) {
      alert(error.message);
    }
  });
}

function renderTelegramSetup() {
  const bot = state.selectedBusiness?.telegram;
  const businessId = state.selectedBusiness?.id || "";
  const botConnected = isTelegramConnected(state.selectedBusiness);
  app.innerHTML = `
    <div class="tg-setup-page">
      <div class="tg-setup-left">
        <a class="logo" href="/">
          <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="28" height="28" />
          <span class="logo-name">swift-deploy.in</span>
        </a>
        <div class="tg-setup-left-content">
          <div class="tg-platform-badge">
            <svg width="28" height="28" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="14" fill="#229ED9"/><path d="M38.94 14.29L33.6 38.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L12.37 29.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
            Telegram AI Bot
          </div>
          <h2 class="tg-setup-title">Connect your Telegram bot in 3 steps</h2>
          <div class="tg-setup-steps">
            <div class="tg-setup-step">
              <div class="tg-step-num">1</div>
              <div>Open <strong>Telegram</strong> and search for <strong>@BotFather</strong></div>
            </div>
            <div class="tg-setup-step">
              <div class="tg-step-num">2</div>
              <div>Send <code>/newbot</code> and follow the prompts to create your bot</div>
            </div>
            <div class="tg-setup-step">
              <div class="tg-step-num">3</div>
              <div>Copy the bot token BotFather gives you and paste it here</div>
            </div>
          </div>
        </div>
      </div>
      <div class="tg-setup-right">
        <div class="tg-setup-form-wrap">
          ${botConnected ? `
            <div class="tg-connected-state">
              <div class="tg-connected-icon">âœ…</div>
              <h2>Telegram bot connected!</h2>
              <p>Your bot <strong>@${escapeHtml(bot.botUsername)}</strong> is live and ready.</p>
              <p class="tg-connected-sub">Students can now message your Telegram bot and your AI will reply instantly — no pre-messages, no delays.</p>
              <button class="button" onclick="state.telegramSetup=false;state.selectedProduct='whatsapp';render()">Go to Dashboard →</button>
              <button class="ghost-button" style="margin-top:12px;" id="tg-disconnect-btn">Disconnect bot</button>
            </div>
          ` : `
            <div class="tg-setup-form-header">
              <h1>Connect your Telegram bot</h1>
              <p>Paste your BotFather token below — your AI goes live in seconds.</p>
            </div>
            <div id="tg-error" class="form-error" style="display:none;"></div>
            <form id="tg-token-form">
              <div class="field">
                <label>Bot Token from BotFather</label>
                <input class="input" id="tg-token-input" placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" required />
                <div class="field-hint">Looks like: 1234567890:ABCdef...</div>
              </div>
              <button class="button" type="submit" style="width:100%;justify-content:center;" id="tg-submit-btn">
                Connect Telegram Bot →
              </button>
            </form>
            <div class="tg-skip-link">
              <a href="#" onclick="state.telegramSetup=false;state.selectedProduct='whatsapp';render();return false;">Skip for now → Use WhatsApp instead</a>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  document.getElementById("tg-token-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.getElementById("tg-token-input").value.trim();
    const btn = document.getElementById("tg-submit-btn");
    const errEl = document.getElementById("tg-error");
    btn.disabled = true;
    btn.textContent = "Connecting...";
    errEl.style.display = "none";
    try {
      const res = await api(`/api/businesses/${businessId}/telegram`, {
        method: "POST",
        body: { token }
      });
      if (res.ok) {
        await loadBootstrap(businessId);
        renderTelegramSetup();
      } else {
        throw new Error(res.error || "Failed to connect.");
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Connect Telegram Bot →";
    }
  });

  document.getElementById("tg-disconnect-btn")?.addEventListener("click", async () => {
    if (!confirm("Disconnect this Telegram bot?")) return;
    await api(`/api/businesses/${businessId}/telegram`, { method: "DELETE" });
    await loadBootstrap(businessId);
    renderTelegramSetup();
  });
}

function renderSetupFlow() {
  const userName = state.user?.name?.split(" ")[0] || "there";
  const biz = state.selectedBusiness;
  const step = isWhatsAppComingSoon() && state.setupStep === "wa-form"
    ? "choice"
    : (state.setupStep || "choice");
  if (step !== state.setupStep) {
    state.setupStep = step;
  }

  const paymentPopupHtml = state.showPaymentPopup ? `
    <div class="payment-overlay" id="payment-overlay">
      <div class="payment-popup">
        <div class="payment-popup-close" id="payment-popup-close">&times;</div>
        <div class="payment-popup-icon">⚡</div>
        <div class="payment-popup-badge">One Plan &middot; Everything Included</div>
        <h2 class="payment-popup-title">Activate your AI bot</h2>
        <p class="payment-popup-sub">Your bot setup is complete. Subscribe to go live instantly.</p>
        <div class="payment-popup-price">
          <span class="payment-price-big">₹2,499</span><span class="payment-price-period">/month</span>
          <span class="payment-price-or">or</span>
          <span class="payment-price-big payment-price-usd">$39</span><span class="payment-price-period">/month</span>
        </div>
        ${renderFeatureList([
          "WhatsApp AI Bot (24/7)",
          "Telegram AI Bot (instant)",
          "Unlimited AI replies — any language",
          "Cancel anytime"
        ], "payment-popup-features")}
        ${renderPaymentButtons({ className: "payment-popup-buttons", style: "" })}
        <div class="payment-popup-note">Secure payment &middot; Cancel anytime &middot; Instant activation</div>
      </div>
    </div>
  ` : "";

  const waForm = step === "wa-form" ? `
    <div class="setup-form-wrap">
      <div class="setup-form-back" id="setup-back">← Back</div>
      <div class="setup-platform-header">
        <div class="setup-platform-icon setup-platform-icon--wa">
          <svg width="36" height="36" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
        </div>
        <div>
          <h2 class="setup-platform-name">WhatsApp AI Bot</h2>
          <p class="setup-platform-sub">Enter your Meta WhatsApp credentials to connect your number professionally</p>
        </div>
      </div>
      <div class="setup-wa-steps">
        <div class="setup-step-item"><span class="setup-step-num">1</span>Go to <strong>Meta for Developers</strong> → create a WhatsApp app</div>
        <div class="setup-step-item"><span class="setup-step-num">2</span>Copy your <strong>Phone Number ID</strong>, <strong>Access Token</strong>, and <strong>App Secret</strong></div>
        <div class="setup-step-item"><span class="setup-step-num">3</span>Paste them below — subscribe to go live</div>
      </div>
      <form id="setup-wa-form" class="setup-form">
        <div class="setup-split">
          <div class="setup-field">
            <label>Your WhatsApp number</label>
            <input class="input" name="whatsappDisplayPhoneNumber" placeholder="+91 98765 43210" required />
          </div>
          <div class="setup-field">
            <label>Phone Number ID</label>
            <input class="input" name="whatsappPhoneNumberId" placeholder="From Meta app dashboard" required />
          </div>
        </div>
        <div class="setup-field">
          <label>Access Token</label>
          <input class="input" name="whatsappAccessToken" placeholder="EAA..." required />
        </div>
        <div class="setup-field">
          <label>App Secret</label>
          <input class="input" name="whatsappAppSecret" placeholder="Meta App Secret" required />
        </div>
        <input type="hidden" name="whatsappProvider" value="meta" />
        <button class="button" type="submit" style="width:100%;justify-content:center;margin-top:8px;">${paymentCtaLabel("Connect WhatsApp →")}</button>
      </form>
    </div>
  ` : "";

  const tgForm = step === "tg-form" ? `
    <div class="setup-form-wrap">
      <div class="setup-form-back" id="setup-back">← Back</div>
      <div class="setup-platform-header">
        <div class="setup-platform-icon setup-platform-icon--tg">
          <svg width="36" height="36" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#229ED9"/><path d="M36.94 12.29L31.6 36.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L10.37 27.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
        </div>
        <div>
          <h2 class="setup-platform-name">Telegram AI Bot</h2>
          <p class="setup-platform-sub">Paste your BotFather token — no Meta approval needed</p>
        </div>
      </div>
      <div class="setup-wa-steps setup-wa-steps--telegram">
        <div class="setup-steps-head">
          <div class="setup-steps-kicker">Quick setup</div>
          <div class="setup-steps-note">Complete these three steps in Telegram, then paste your token below.</div>
        </div>
        <div class="setup-step-item">
          <span class="setup-step-num">1</span>
          <div class="setup-step-copy">Open Telegram and search for <strong class="setup-step-accent">@BotFather</strong></div>
        </div>
        <div class="setup-step-item">
          <span class="setup-step-num">2</span>
          <div class="setup-step-copy">Send <strong class="setup-step-accent">/newbot</strong> and follow the prompts to create your bot</div>
        </div>
        <div class="setup-step-item">
          <span class="setup-step-num">3</span>
          <div class="setup-step-copy">Copy the token from <strong class="setup-step-accent">BotFather</strong> and paste it below</div>
        </div>
      </div>
      <form id="setup-tg-form" class="setup-form">
        <div class="setup-field">
          <label>BotFather Token</label>
          <input class="input" id="setup-tg-token" name="token" placeholder="1234567890:ABCDefGHIjklMNOpqrSTUvwxYZ" required />
          <small style="color:rgba(255,255,255,0.4);font-size:0.78rem;margin-top:4px;display:block;">Looks like: 1234567890:ABCDefGHI...</small>
        </div>
        <div id="setup-tg-error" class="form-error" style="display:none;margin-bottom:8px;"></div>
        <button class="button" type="submit" style="width:100%;justify-content:center;margin-top:8px;">${paymentCtaLabel("Connect & Go Live →")}</button>
      </form>
    </div>
  ` : "";

  const setupWhatsAppChoiceCard = isWhatsAppComingSoon()
    ? renderDisabledPlatformSurface("button", "setup-choice-card setup-choice-wa", `
        <div class="setup-choice-icon">
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
        </div>
        <div class="setup-choice-info">
          <h3>WhatsApp AI Bot</h3>
          <p>Connect your WhatsApp number. AI replies to every message automatically — 24/7, any language.</p>
          <ul class="setup-choice-features">
            <li>Works on any WhatsApp number</li>
            <li>Instant AI replies, any language</li>
            <li>Meta Cloud API (free tier available)</li>
          </ul>
        </div>
        <div class="setup-choice-cta setup-choice-cta--wa">Connect WhatsApp →</div>
      `, `type="button" id="setup-pick-wa" disabled`)
    : `
      <button class="setup-choice-card setup-choice-wa" id="setup-pick-wa">
        <div class="setup-choice-icon">
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
        </div>
        <div class="setup-choice-info">
          <h3>WhatsApp AI Bot</h3>
          <p>Connect your WhatsApp number. AI replies to every message automatically — 24/7, any language.</p>
          <ul class="setup-choice-features">
            <li>Works on any WhatsApp number</li>
            <li>Instant AI replies, any language</li>
            <li>Meta Cloud API (free tier available)</li>
          </ul>
        </div>
        <div class="setup-choice-cta setup-choice-cta--wa">Connect WhatsApp →</div>
      </button>
    `;

  const choiceGrid = step === "choice" ? `
    <div class="setup-choice-grid">
      ${setupWhatsAppChoiceCard}
      <button class="setup-choice-card setup-choice-tg" id="setup-pick-tg">
        <div class="setup-choice-icon">
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#229ED9"/><path d="M36.94 12.29L31.6 36.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L10.37 27.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
        </div>
        <div class="setup-choice-info">
          <h3>Telegram AI Bot</h3>
          <p>Paste your BotFather token and your AI bot goes live instantly — no approval, no waiting.</p>
          <ul class="setup-choice-features">
            <li>Live in under 60 seconds</li>
            <li>No Meta approval needed</li>
            <li>Same powerful AI as WhatsApp</li>
          </ul>
        </div>
        <div class="setup-choice-cta setup-choice-cta--tg">Connect Telegram →</div>
      </button>
    </div>
  ` : "";

  app.innerHTML = `
    ${paymentPopupHtml}
    <div class="setup-flow-page">
      <div class="setup-flow-topbar">
        <div class="logo">
          <img src="/logo.svg?v=crab-mark-3" class="logo-img" alt="swift-deploy.in" width="30" height="30" />
          <span class="logo-name">swift-deploy.in</span>
        </div>
        <div class="setup-flow-topbar-right">
          <span class="setup-flow-welcome">Welcome <strong>${escapeHtml(userName)}</strong></span>
          <button class="ghost-button" id="setup-logout" style="font-size:0.82rem;padding:6px 14px;">Log out</button>
        </div>
      </div>

      <div class="setup-flow-body">
        ${step === "choice" ? `
          <div class="setup-flow-header">
            <span class="eyebrow">Step 1 of 2 — Choose Platform</span>
            <h1 class="setup-flow-title">Where should your AI bot reply?</h1>
            <p class="setup-flow-sub">Pick a platform to connect. You can add the other one after subscribing.</p>
          </div>
        ` : `
          <div class="setup-flow-header">
            <span class="eyebrow">Step 2 of 2 — Connect & Subscribe</span>
            <h1 class="setup-flow-title">${step === "wa-form" ? "Connect your WhatsApp" : "Connect your Telegram bot"}</h1>
            <p class="setup-flow-sub">Fill in your credentials below, then subscribe to activate.</p>
          </div>
        `}
        ${choiceGrid}
        ${waForm}
        ${tgForm}
      </div>
    </div>
  `;

  // Logout
  document.querySelector("#setup-logout")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null; state.selectedBusiness = null; state.userBusinesses = [];
    state.setupStep = "choice"; state.showPaymentPopup = false; state.pendingPlatformSetup = null;
    render();
  });

  // Platform choice
  if (!isWhatsAppComingSoon()) {
    document.querySelector("#setup-pick-wa")?.addEventListener("click", () => {
      state.setupStep = "wa-form"; renderSetupFlow();
    });
  }
  document.querySelector("#setup-pick-tg")?.addEventListener("click", () => {
    state.setupStep = "tg-form"; renderSetupFlow();
  });
  document.querySelector("#setup-back")?.addEventListener("click", () => {
    state.setupStep = "choice"; state.showPaymentPopup = false; renderSetupFlow();
  });

  // WA form submit → validate then show payment popup (or connect directly if pricing disabled)
  document.querySelector("#setup-wa-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formToObject(e.target);
    const numEl = e.target.querySelector("[name=whatsappDisplayPhoneNumber]");
    const idEl = e.target.querySelector("[name=whatsappPhoneNumberId]");
    const tokEl = e.target.querySelector("[name=whatsappAccessToken]");
    const secretEl = e.target.querySelector("[name=whatsappAppSecret]");
    let valid = true;
    [numEl, idEl, tokEl, secretEl].forEach((el) => { if (el) el.classList.remove("input--error"); });
    if (!data.whatsappDisplayPhoneNumber?.trim()) { if (numEl) numEl.classList.add("input--error"); valid = false; }
    if (!data.whatsappPhoneNumberId?.trim()) { if (idEl) idEl.classList.add("input--error"); valid = false; }
    if (!data.whatsappAccessToken?.trim()) { if (tokEl) tokEl.classList.add("input--error"); valid = false; }
    if (!data.whatsappAppSecret?.trim()) { if (secretEl) secretEl.classList.add("input--error"); valid = false; }
    if (!valid) return;
    if (hasEnabledBillingProvider()) {
      state.pendingPlatformSetup = { platform: "whatsapp", config: data };
      state.showPaymentPopup = true;
      renderSetupFlow();
    } else {
      const btn = e.target.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
      try {
        const result = await api(`/api/businesses/${encodeURIComponent(biz.id)}/whatsapp`, { method: "POST", body: data });
        await loadBootstrap(biz.id);
        state.billingActivated = true;
        if (isWhatsAppReady(state.selectedBusiness)) {
          state.showBotLivePopup = true;
        } else {
          showWhatsAppSetupAlert(result?.setup);
        }
        render();
      } catch (err) { alert(err.message); if (btn) { btn.disabled = false; btn.textContent = paymentCtaLabel("Connect WhatsApp →"); } }
    }
  });

  // TG form submit → validate then show payment popup (or connect directly if pricing disabled)
  document.querySelector("#setup-tg-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tokenInput = document.querySelector("#setup-tg-token");
    const token = tokenInput?.value?.trim();
    const errEl = document.querySelector("#setup-tg-error");
    if (errEl) errEl.style.display = "none";
    if (tokenInput) tokenInput.classList.remove("input--error");
    if (!token) { if (tokenInput) tokenInput.classList.add("input--error"); return; }
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(token)) {
      if (tokenInput) tokenInput.classList.add("input--error");
      if (errEl) { errEl.textContent = "Invalid token format. It should look like: 1234567890:ABCDefGHI..."; errEl.style.display = "block"; }
      return;
    }
    if (hasEnabledBillingProvider()) {
      state.pendingPlatformSetup = { platform: "telegram", token };
      state.showPaymentPopup = true;
      renderSetupFlow();
    } else {
      const btn = e.target.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
      try {
        await api(`/api/businesses/${encodeURIComponent(biz.id)}/telegram`, { method: "POST", body: { token } });
        await loadBootstrap(biz.id);
        state.billingActivated = true;
        state.showBotLivePopup = true;
        render();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = paymentCtaLabel("Connect & Go Live →"); }
      }
    }
  });

  // Payment popup close
  document.querySelector("#payment-popup-close")?.addEventListener("click", () => {
    state.showPaymentPopup = false; renderSetupFlow();
  });
  document.querySelector("#payment-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "payment-overlay") { state.showPaymentPopup = false; renderSetupFlow(); }
  });

  attachPaymentButtonHandlers();
}

function render() {
  if (state.route === "landing") {
    renderLanding();
    return;
  }

  if (!state.authChecked) {
    app.innerHTML = `
      <main class="app-shell">
        <div class="shell">
          <section class="card"><div class="empty">Loading workspace...</div></section>
        </div>
      </main>
    `;
    return;
  }

  if (!state.user) {
    if (state.authMode === "platform") {
      renderPlatformChoice();
    } else {
      renderAuth();
    }
    return;
  }

  if (needsOnboarding() || (state.showOnboarding && state.onboardingStep > 0)) {
    if (!state.onboardingStep) state.onboardingStep = 1;
    renderOnboarding();
    return;
  }

  const billing = state.selectedBusiness?.billing;
  const activeBilling = state.billingActivated || ["active", "trialing"].includes((billing?.status || "").toLowerCase());
  if (!activeBilling) {
    renderSetupFlow();
    return;
  }

  renderDashboard();
}

async function init() {
  try {
    await loadPlans();
    if (state.route === "landing") {
      render();
      return;
    }

    await loadAuth();
    if (state.user) {
      await loadBootstrap(pageParams.get("businessId") || "");
      if (pageParams.get("billing") === "cancel") {
        writeStoredPendingPlatformSetup(null);
      }

      // If returning from checkout after payment, apply any pending platform setup
      if (pageParams.get("billing") === "success") {
        state.billingActivated = true;
        const pending = readStoredPendingPlatformSetup();
        if (pending && state.selectedBusiness?.id) {
          writeStoredPendingPlatformSetup(null);
          try {
            let connectResult = null;
            if (pending.platform === "telegram") {
              await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, { method: "POST", body: { token: pending.token } });
            } else if (pending.platform === "whatsapp" && !isWhatsAppComingSoon()) {
              connectResult = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/whatsapp`, { method: "POST", body: pending.config });
            }
            await loadBootstrap(state.selectedBusiness.id);
            if (pending.platform === "telegram") {
              state.showBotLivePopup = true;
            } else if (pending.platform === "whatsapp" && !isWhatsAppComingSoon()) {
              if (isWhatsAppReady(state.selectedBusiness)) {
                state.showBotLivePopup = true;
              } else {
                showWhatsAppSetupAlert(connectResult?.setup);
              }
            }
          } catch (err) { /* ignore, bot connect failed, user can reconnect from dashboard */ }
        }
      }
    }
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="app-shell">
        <div class="shell">
          <section class="card"><div class="empty">${escapeHtml(error.message)}</div></section>
        </div>
      </main>
    `;
  }
}

init();
