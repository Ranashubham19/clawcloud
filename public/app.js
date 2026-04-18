const app = document.querySelector("#app");
const pageParams = new URLSearchParams(window.location.search);
const dashboardTabs = new Set(["overview", "leads", "chats", "bookings", "billing", "team", "apikeys", "audit", "analytics", "settings", "admin"]);
const PRICING_ENABLED = false; // set to true to re-enable payment popup before platform connect

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

const state = {
  route: window.location.pathname === "/app" ? "app" : "landing",
  authChecked: false,
  user: null,
  plans: [],
  billingEnabled: false,
  userBusinesses: [],
  selectedBusiness: null,
  analytics: null,
  advancedAnalytics: null,
  readiness: { score: 0, total: 0, items: [] },
  billing: null,
  billingNotice: initialBillingNotice(),
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
  selectedProduct: pageParams.get("product") || "whatsapp",
  telegramSetup: false,
  showPaymentPopup: false,
  pendingPlatformSetup: null,
  setupStep: "choice",
  billingActivated: false
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isTelegramConnected(business = state.selectedBusiness) {
  const telegram = business?.telegram || {};
  return Boolean(telegram.configured || telegram.tokenConfigured || telegram.token);
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
              <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </div>
            <div class="nav-links"></div>
            <div class="nav-actions">
              <a class="ghost-button" href="/app?mode=platform">Log in</a>
              <a class="button" href="/app?mode=platform">Get started free</a>
            </div>
          </div>
        </div>
      </nav>

      <!-- HERO -->
      <section class="lp-hero">
        <div class="shell">
          <div class="lp-hero-inner">
            <span class="eyebrow">AI Bot Platform — swift-deploy.in</span>
            <h1 class="lp-h1">One AI. Every platform.<br>Zero manual work.</h1>
            <p class="lp-sub">swift-deploy.in gives your business an AI-powered bot that replies 24/7, supports any language, and works on WhatsApp and Telegram — live in under 2 minutes.</p>
          </div>
        </div>
      </section>

      <!-- PLATFORM CHOOSER -->
      <section class="lp-platforms">
        <div class="shell">
          <div class="lp-platforms-header">
            <h2 class="lp-h2">Choose your platform</h2>
            <p class="lp-section-sub">Pick the messaging app you want to automate. You can add more later.</p>
          </div>
          <div class="lp-platform-grid">
            <a href="/app?mode=signup&product=whatsapp" class="lp-platform-card lp-platform-whatsapp">
              <div class="lp-platform-icon">
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                  <rect width="52" height="52" rx="14" fill="#25D366"/>
                  <path d="M26 10C17.163 10 10 17.163 10 26c0 2.837.737 5.5 2.025 7.813L10 42l8.4-2.2A15.916 15.916 0 0026 42c8.837 0 16-7.163 16-16S34.837 10 26 10zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0112.8 26c0-7.275 5.925-13.2 13.2-13.2 7.275 0 13.2 5.925 13.2 13.2 0 7.275-5.925 13.2-13.2 13.2zm7.25-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/>
                </svg>
              </div>
              <div class="lp-platform-info">
                <h3>WhatsApp AI Bot</h3>
                <p>AI assistant for WhatsApp Business. Capture leads, book demos, answer FAQs — all automatically.</p>
                <ul class="lp-platform-features">
                  <li>Lead capture &amp; CRM dashboard</li>
                  <li>Demo booking automation</li>
                  <li>Multi-language AI replies</li>
                </ul>
              </div>
              <div class="lp-platform-cta">Get started free →</div>
            </a>
            <a href="/app?mode=signup&product=telegram" class="lp-platform-card lp-platform-telegram">
              <div class="lp-platform-icon">
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                  <rect width="52" height="52" rx="14" fill="#229ED9"/>
                  <path d="M38.94 14.29L33.6 38.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L12.37 29.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/>
                </svg>
              </div>
              <div class="lp-platform-info">
                <h3>Telegram AI Bot</h3>
                <p>Connect your Telegram bot in seconds. Paste your BotFather token and your AI goes live instantly.</p>
                <ul class="lp-platform-features">
                  <li>Instant bot activation</li>
                  <li>Same AI as WhatsApp</li>
                  <li>No extra setup needed</li>
                </ul>
              </div>
              <div class="lp-platform-cta">Connect Telegram →</div>
            </a>
          </div>
          <div class="lp-platforms-login">Already have an account? <a href="/app?mode=login">Sign in →</a></div>
        </div>
      </section>

      <!-- FEATURES -->
      <section class="lp-section" id="features">
        <div class="shell">
          <div class="lp-section-header">
            <span class="eyebrow">Platform Features</span>
            <h2 class="lp-h2">Everything your team needs,<br>nothing you don't.</h2>
            <p class="lp-section-sub">Built for businesses that rely on WhatsApp to drive sales, bookings, and customer conversations.</p>
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
              <div class="lp-feature-icon">📲</div>
              <h3>WhatsApp + Telegram</h3>
              <p>One subscription. Connect both WhatsApp and Telegram. Your AI bot works across both platforms simultaneously.</p>
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
              <div class="lp-feature-icon">🔒</div>
              <h3>Secure & Private</h3>
              <p>Your credentials are encrypted at rest. All webhook traffic is verified. Your users' conversations are never shared.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA BANNER -->
      <section class="lp-cta-banner">
        <div class="shell">
          <div class="lp-cta-banner-inner">
            <h2 class="lp-h2" style="color:#fff;">Start your AI bot today</h2>
            <p style="color:rgba(255,255,255,0.65);margin:12px 0 16px;font-size:1rem;">Connect WhatsApp or Telegram in under 2 minutes. No technical skills required.</p>
            <div class="lp-cta-price-tag">One simple plan — <strong>$49/month</strong> or <strong>₹2,999/month</strong></div>
            <a class="button lp-cta-btn" href="/app?mode=platform" style="margin-top:24px;">Choose your platform →</a>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="lp-footer">
        <div class="shell">
          <div class="lp-footer-inner">
            <div class="logo">
              <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </div>
            <div class="lp-footer-links">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="/data-deletion">Data Deletion</a>
              <a href="/app?mode=login">Dashboard</a>
            </div>
            <div class="lp-footer-copy">© 2026 swift-deploy.in. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  `;
}

function renderPlatformChoice() {
  app.innerHTML = `
    <div class="platform-choice-page">
      <nav class="landing-nav">
        <div class="shell">
          <div class="nav-inner">
            <a class="logo" href="/">
              <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
              <span class="logo-name">swift-deploy.in</span>
            </a>
          </div>
        </div>
      </nav>
      <div class="platform-choice-body">
        <div class="platform-choice-header">
          <span class="eyebrow">Get started in 2 minutes</span>
          <h1 class="platform-choice-title">Choose your platform</h1>
          <p class="platform-choice-sub">Pick where you want your AI bot to reply. You can connect both after setup.</p>
        </div>
        <div class="platform-choice-grid">
          <a href="/app?mode=signup&product=whatsapp" class="platform-choice-card platform-choice-wa">
            <div class="platform-choice-icon">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
            </div>
            <div class="platform-choice-info">
              <h2>WhatsApp AI Bot</h2>
              <p>Connect your WhatsApp number. AI replies to every message automatically — 24/7, any language.</p>
              <ul class="platform-choice-features">
                <li>Instant AI replies to any question</li>
                <li>Works on any WhatsApp number</li>
                <li>Multi-language support</li>
              </ul>
            </div>
            <div class="platform-choice-cta platform-choice-cta--wa">Get started →</div>
          </a>
          <a href="/app?mode=signup&product=telegram" class="platform-choice-card platform-choice-tg">
            <div class="platform-choice-icon">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="14" fill="#229ED9"/><path d="M36.94 12.29L31.6 36.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L10.37 27.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
            </div>
            <div class="platform-choice-info">
              <h2>Telegram AI Bot</h2>
              <p>Paste your BotFather token and your AI bot goes live instantly — no approval, no payment method needed to start.</p>
              <ul class="platform-choice-features">
                <li>Live in under 60 seconds</li>
                <li>No Meta approval needed</li>
                <li>Same powerful AI as WhatsApp</li>
              </ul>
            </div>
            <div class="platform-choice-cta platform-choice-cta--tg">Connect Telegram →</div>
          </a>
        </div>
        <div class="platform-choice-login">Already have an account? <a href="/app?mode=login">Sign in →</a></div>
      </div>
    </div>
  `;
}

function renderAuth() {
  const isSignup = state.authMode === "signup";
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-left">
        <a class="logo" href="/">
          <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="28" height="28" />
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
        <div class="auth-left-footer">© 2026 swift-deploy.in · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>
      </div>

      <div class="auth-right">
        <div class="auth-form-wrap">
          <div class="auth-form-header">
            <h1 class="auth-form-title">${isSignup ? "Create your account" : "Welcome back"}</h1>
            <p class="auth-form-sub">${isSignup ? "Start your free workspace — no credit card required." : "Sign in to your ClawCloud dashboard."}</p>
          </div>

          <a class="google-button" href="/api/auth/google">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.6-7.7 19.6-20 0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4c-7.8 0-14.5 4.3-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.5 5C9.4 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.8 6l6.2 5.2C40.7 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
            Continue with Google
          </a>

          <div class="divider">or continue with email</div>

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
              <div class="billing-active-icon">✅</div>
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
                <span class="billing-price-big">₹2,999</span><span class="billing-price-period">/month</span>
                <span class="billing-price-or">or</span>
                <span class="billing-price-big billing-price-usd">$49</span><span class="billing-price-period">/month</span>
              </div>
              <ul class="billing-plan-features">
                <li>✓ WhatsApp AI Bot</li>
                <li>✓ Telegram AI Bot</li>
                <li>✓ Unlimited AI replies</li>
                <li>✓ Any language support</li>
                <li>✓ 24/7 always-on</li>
              </ul>
            </div>
            ${activeBilling ? `
              <div class="status-badge ok" style="width:fit-content;">Active — Bot is running</div>
            ` : `
              <div class="payment-buttons" style="margin-top:4px;">
                <button class="button razorpay-btn" type="button" data-upgrade-plan="pro" data-provider="razorpay" style="flex:1;">
                  🇮🇳 Pay ₹2,999/mo
                </button>
                <button class="button stripe-btn" type="button" data-upgrade-plan="pro" data-provider="stripe" style="flex:1;">
                  🌍 Pay $49/mo
                </button>
              </div>
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
                <div class="status-row"><span class="muted">Messages</span><span>${escapeHtml(String(state.usage.messages || 0))} / ${escapeHtml(String(state.usageLimits?.messagesPerMonth || "∞"))}</span></div>
                <div class="status-row"><span class="muted">Leads</span><span>${escapeHtml(String(state.usage.leads || 0))} / ${escapeHtml(String(state.usageLimits?.leadsMax || "∞"))}</span></div>
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
    case "settings":
      const waConn = state.selectedBusiness?.whatsapp;
      const waIsLive = Boolean(waConn?.phoneNumberId && waConn?.accessToken);
      return `
        <section class="card">
          <div class="settings-wa-header">
            <div class="settings-wa-icon">
              <svg width="28" height="28" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
            </div>
            <div>
              <div class="settings-wa-title">Connect WhatsApp</div>
              <div class="muted" style="font-size:0.85rem;">Enter your WhatsApp Cloud API credentials to let your AI bot reply to messages</div>
            </div>
            <div class="platform-card-badge ${waIsLive ? "badge--live" : "badge--idle"}" style="margin-left:auto;">
              ${waIsLive ? "● Live" : "○ Not connected"}
            </div>
          </div>

          ${waIsLive ? `
            <div class="platform-connected-info" style="margin:18px 0;">
              <div class="pci-row"><span>Phone Number</span><strong>${escapeHtml(waConn.displayPhoneNumber || waConn.phoneNumberId || "Connected")}</strong></div>
              <div class="pci-row"><span>Status</span><strong style="color:#25d366;">Active — AI replying to messages</strong></div>
            </div>
          ` : ""}

          <form id="settings-form" class="section">
            <div class="settings-wa-steps" style="margin-bottom:20px;">
              <div class="pc-step"><span class="pc-step-n">1</span>Go to <strong>Meta for Developers</strong> → Create a WhatsApp app</div>
              <div class="pc-step"><span class="pc-step-n">2</span>Copy your <strong>Phone Number ID</strong> and <strong>Access Token</strong> from the app dashboard</div>
              <div class="pc-step"><span class="pc-step-n">3</span>Paste them below and save — your bot goes live instantly</div>
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
                <input class="input" name="whatsappAccessToken" placeholder="EAA..." value="${escapeHtml(waConn?.accessToken || "")}" />
                <small>Permanent token from Meta app</small>
              </div>
              <div class="field">
                <label>Business Account ID <span class="muted">(optional)</span></label>
                <input class="input" name="whatsappBusinessAccountId" placeholder="From Meta Business Suite" value="${escapeHtml(waConn?.businessAccountId || "")}" />
              </div>
            </div>
            <input type="hidden" name="whatsappProvider" value="meta" />
            <div class="form-actions">
              <button class="button" type="submit">${waIsLive ? "Update WhatsApp" : "Connect WhatsApp"}</button>
            </div>
          </form>
        </section>
      `;
          `}
        </section>
      `;
    default: {
      const tg = state.selectedBusiness?.telegram;
      const tgConnected = isTelegramConnected(state.selectedBusiness);
      const waConnected = Boolean(state.selectedBusiness?.whatsapp?.phoneNumberId || state.selectedBusiness?.whatsapp?.apiKey);
      const totalChats = state.analytics?.totalChats || 0;
      return `
        <div class="dash-hero">
          <div class="dash-hero-left">
            <div class="dash-hero-greeting">Welcome back, <span class="dash-hero-name">${escapeHtml(state.user?.name?.split(" ")[0] || "there")}</span></div>
            <div class="dash-hero-sub">Your AI bot is ${(tgConnected || waConnected) ? "running 24/7 ✦" : "ready to connect"}</div>
          </div>
          <div class="dash-hero-stats">
            <div class="dash-stat-pill">
              <span class="dash-stat-num">${totalChats}</span>
              <span class="dash-stat-lbl">Conversations</span>
            </div>
            <div class="dash-stat-pill">
              <span class="dash-stat-num">${(tgConnected ? 1 : 0) + (waConnected ? 1 : 0)}</span>
              <span class="dash-stat-lbl">Active bots</span>
            </div>
          </div>
        </div>

        <div class="platform-cards-grid">

          <!-- WhatsApp Card -->
          <div class="pcard ${waConnected ? "pcard--live pcard--wa-live" : "pcard--wa-idle"}">
            <div class="pcard-glow pcard-glow--wa"></div>
            <div class="pcard-top">
              <div class="pcard-icon pcard-icon--wa">
                <svg width="26" height="26" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#25D366"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.163 8 8 15.163 8 24c0 2.837.737 5.5 2.025 7.813L8 40l8.4-2.2A15.916 15.916 0 0024 40c8.837 0 16-7.163 16-16S32.837 8 24 8zm0 29.2a13.1 13.1 0 01-6.688-1.825l-.475-.287-4.988 1.3 1.325-4.85-.313-.5A13.128 13.128 0 0110.8 24c0-7.275 5.925-13.2 13.2-13.2S37.2 16.725 37.2 24 31.275 37.2 24 37.2zm7.24-9.887c-.4-.2-2.363-1.163-2.725-1.3-.363-.125-.625-.187-.888.2-.262.387-1.025 1.3-1.25 1.562-.225.263-.45.288-.85.1-.4-.2-1.688-.625-3.213-1.987-1.187-1.063-1.988-2.375-2.225-2.775-.225-.4-.025-.612.175-.812.175-.175.4-.463.6-.688.2-.225.262-.387.4-.65.137-.262.062-.487-.037-.687-.1-.2-.888-2.15-1.225-2.938-.325-.763-.65-.662-.888-.675-.225-.012-.487-.012-.75-.012-.262 0-.688.1-1.05.487-.362.387-1.387 1.35-1.387 3.3 0 1.95 1.425 3.837 1.625 4.1.2.262 2.788 4.262 6.763 5.975.938.412 1.675.65 2.25.838.95.3 1.813.262 2.487.162.763-.112 2.363-.963 2.7-1.9.337-.937.337-1.737.237-1.9-.1-.15-.362-.25-.762-.45z" fill="white"/></svg>
              </div>
              <div class="pcard-title-wrap">
                <div class="pcard-platform">WhatsApp</div>
                <div class="pcard-status ${waConnected ? "pcard-status--live" : "pcard-status--idle"}">
                  <span class="pcard-dot"></span>${waConnected ? "Live — AI replying" : "Not connected"}
                </div>
              </div>
            </div>
            <div class="pcard-body">
              ${waConnected ? `
                <div class="pcard-info-rows">
                  <div class="pcard-info-row"><span>Number</span><strong>${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || "Connected")}</strong></div>
                  <div class="pcard-info-row"><span>Replies</span><strong style="color:#25d366;">24/7 automated</strong></div>
                </div>
                <p class="pcard-desc">Your WhatsApp AI bot is live and replying to every message instantly. Share your number with users to start conversations.</p>
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
          <textarea class="ob2-textarea" name="description" rows="2" placeholder="e.g. Premium JEE & NEET coaching for Class 9–12. 15 years of results, expert faculty, small batches.">${escapeHtml(biz?.description || "")}</textarea>
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
          <textarea class="ob2-textarea ob2-textarea--code" name="courseText" rows="8" placeholder="JEE Main & Advanced | Mon Wed Fri 5–7 pm | ₹8,000/month | jee,iit,engineering | Comprehensive 2-year JEE prep with test series
NEET | Tue Thu Sat 4–6 pm | ₹7,500/month | neet,medical,biology | NEET coaching for Class 11–12 with biology focus
Foundation (Class 8–10) | Daily 4–5 pm | ₹5,000/month | foundation,school,cbse | School subject coaching with competitive exam base">${escapeHtml(serializeCourses(biz?.courseItems || []))}</textarea>
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
What are the batch timings? | Morning 6–8 am, Afternoon 2–4 pm, Evening 5–7 pm batches available.
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
          <img src="/logo.svg" width="28" height="28" class="logo-img" alt="ClawCloud" />
          <span class="logo-name">ClawCloud</span>
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

function renderDashboard() {
  const tgLive = isTelegramConnected(state.selectedBusiness);
  const waLive = Boolean(state.selectedBusiness?.whatsapp?.phoneNumberId && state.selectedBusiness?.whatsapp?.accessToken);
  const anyLive = tgLive || waLive;

  app.innerHTML = `
    ${state.showBotLivePopup ? `
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
    <main class="app-shell">
      <div class="shell">
        <div class="app-topbar">
          <div class="topbar-left">
            <div class="logo">
              <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="32" height="32" />
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

  document.querySelector("#ov-tg-disconnect")?.addEventListener("click", async () => {
    if (!confirm("Disconnect this Telegram bot? It will stop replying to users.")) return;
    try {
      await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, { method: "DELETE" });
      await loadBootstrap(state.selectedBusiness.id);
      render();
    } catch (err) { alert(err.message); }
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
        payload.faqItems = parseFaqText(payload.faqText);
        payload.courseItems = parseCourseText(payload.courseText);
        delete payload.faqText;
        delete payload.courseText;

        await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}`, {
          method: "PATCH",
          body: payload
        });
        await loadBootstrap(state.selectedBusiness.id);
        const waNowLive = Boolean(state.selectedBusiness?.whatsapp?.phoneNumberId && state.selectedBusiness?.whatsapp?.accessToken);
        if (waNowLive) state.showBotLivePopup = true;
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  }

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

  document.querySelectorAll("[data-upgrade-plan]").forEach((button) => {
    button.addEventListener("click", async () => {
      const plan = button.dataset.upgradePlan;
      const provider = button.dataset.provider || "razorpay";
      try {
        if (provider === "stripe") {
          const payload = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/billing/checkout`, {
            method: "POST",
            body: { plan }
          });
          if (payload.url) window.location.href = payload.url;
        } else {
          const payload = await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/billing/razorpay`, {
            method: "POST",
            body: { plan }
          });
          if (payload.subscriptionId && payload.keyId) {
            if (!window.Razorpay) {
              alert("Razorpay is still loading, please try again in a moment.");
              return;
            }
            const rzp = new window.Razorpay({
              key: payload.keyId,
              subscription_id: payload.subscriptionId,
              name: payload.businessName || "ClawCloud",
              description: `${plan} Plan Subscription`,
              prefill: { email: payload.userEmail, name: payload.userName },
              theme: { color: "#7c6fff" },
              handler: function() {
                window.location.href = payload.callbackUrl || "/app?tab=billing&billing=success";
              }
            });
            rzp.open();
          }
        }
      } catch (error) {
        alert(error.message);
      }
    });
  });

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
          <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="28" height="28" />
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
              <div class="tg-connected-icon">✅</div>
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
  const step = state.setupStep || "choice";

  const paymentPopupHtml = state.showPaymentPopup ? `
    <div class="payment-overlay" id="payment-overlay">
      <div class="payment-popup">
        <div class="payment-popup-close" id="payment-popup-close">✕</div>
        <div class="payment-popup-icon">⚡</div>
        <div class="payment-popup-badge">One Plan · Everything Included</div>
        <h2 class="payment-popup-title">Activate your AI bot</h2>
        <p class="payment-popup-sub">Your bot setup is complete. Subscribe to go live instantly.</p>
        <div class="payment-popup-price">
          <span class="payment-price-big">₹2,999</span><span class="payment-price-period">/month</span>
          <span class="payment-price-or">or</span>
          <span class="payment-price-big payment-price-usd">$49</span><span class="payment-price-period">/month</span>
        </div>
        <ul class="payment-popup-features">
          <li>✓ WhatsApp AI Bot (24/7)</li>
          <li>✓ Telegram AI Bot (instant)</li>
          <li>✓ Unlimited AI replies — any language</li>
          <li>✓ Cancel anytime</li>
        </ul>
        <div class="payment-popup-buttons">
          <button class="button razorpay-btn" id="setup-razorpay-btn" type="button" style="flex:1;">🇮🇳 Pay ₹2,999/mo</button>
          <button class="button stripe-btn" id="setup-stripe-btn" type="button" style="flex:1;">🌍 Pay $49/mo</button>
        </div>
        <div class="payment-popup-note">Secure payment · Cancel anytime · Instant activation</div>
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
          <p class="setup-platform-sub">Enter your Meta WhatsApp credentials to connect your number</p>
        </div>
      </div>
      <div class="setup-wa-steps">
        <div class="setup-step-item"><span class="setup-step-num">1</span>Go to <strong>Meta for Developers</strong> → create a WhatsApp app</div>
        <div class="setup-step-item"><span class="setup-step-num">2</span>Copy your <strong>Phone Number ID</strong> and <strong>Access Token</strong></div>
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
        <input type="hidden" name="whatsappProvider" value="meta" />
        <button class="button" type="submit" style="width:100%;justify-content:center;margin-top:8px;">${PRICING_ENABLED ? "Continue to Payment →" : "Connect & Go Live →"}</button>
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
      <div class="setup-wa-steps">
        <div class="setup-step-item"><span class="setup-step-num">1</span>Open Telegram → search <strong>@BotFather</strong></div>
        <div class="setup-step-item"><span class="setup-step-num">2</span>Send <code>/newbot</code> and follow the steps to create your bot</div>
        <div class="setup-step-item"><span class="setup-step-num">3</span>Copy the token BotFather gives you and paste it below</div>
      </div>
      <form id="setup-tg-form" class="setup-form">
        <div class="setup-field">
          <label>BotFather Token</label>
          <input class="input" id="setup-tg-token" name="token" placeholder="1234567890:ABCDefGHIjklMNOpqrSTUvwxYZ" required />
          <small style="color:rgba(255,255,255,0.4);font-size:0.78rem;margin-top:4px;display:block;">Looks like: 1234567890:ABCDefGHI...</small>
        </div>
        <div id="setup-tg-error" class="form-error" style="display:none;margin-bottom:8px;"></div>
        <button class="button" type="submit" style="width:100%;justify-content:center;margin-top:8px;">${PRICING_ENABLED ? "Continue to Payment →" : "Connect & Go Live →"}</button>
      </form>
    </div>
  ` : "";

  const choiceGrid = step === "choice" ? `
    <div class="setup-choice-grid">
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
          <img src="/logo.svg" class="logo-img" alt="swift-deploy.in" width="30" height="30" />
          <span class="logo-name">swift-deploy.in</span>
        </div>
        <div class="setup-flow-topbar-right">
          <span class="setup-flow-welcome">Welcome, <strong>${escapeHtml(userName)}</strong></span>
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
  document.querySelector("#setup-pick-wa")?.addEventListener("click", () => {
    state.setupStep = "wa-form"; renderSetupFlow();
  });
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
    let valid = true;
    [numEl, idEl, tokEl].forEach((el) => { if (el) el.classList.remove("input--error"); });
    if (!data.whatsappDisplayPhoneNumber?.trim()) { if (numEl) numEl.classList.add("input--error"); valid = false; }
    if (!data.whatsappPhoneNumberId?.trim()) { if (idEl) idEl.classList.add("input--error"); valid = false; }
    if (!data.whatsappAccessToken?.trim()) { if (tokEl) tokEl.classList.add("input--error"); valid = false; }
    if (!valid) return;
    if (PRICING_ENABLED) {
      state.pendingPlatformSetup = { platform: "whatsapp", config: data };
      state.showPaymentPopup = true;
      renderSetupFlow();
    } else {
      const btn = e.target.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
      try {
        await api(`/api/businesses/${encodeURIComponent(biz.id)}`, { method: "PATCH", body: data });
        await loadBootstrap(biz.id);
        state.billingActivated = true;
        state.showBotLivePopup = true;
        render();
      } catch (err) { alert(err.message); if (btn) { btn.disabled = false; btn.textContent = "Continue to Payment →"; } }
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
    if (PRICING_ENABLED) {
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
        if (btn) { btn.disabled = false; btn.textContent = "Continue to Payment →"; }
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

  // Razorpay payment
  document.querySelector("#setup-razorpay-btn")?.addEventListener("click", async () => {
    const btn = document.querySelector("#setup-razorpay-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Opening payment..."; }
    try {
      const payload = await api(`/api/businesses/${encodeURIComponent(biz.id)}/billing/razorpay`, { method: "POST", body: { plan: "pro" } });
      if (payload.subscriptionId && payload.keyId) {
        if (!window.Razorpay) { alert("Razorpay is still loading, please try again."); return; }
        const rzp = new window.Razorpay({
          key: payload.keyId,
          subscription_id: payload.subscriptionId,
          name: payload.businessName || "swift-deploy.in",
          description: "AI Bot Subscription",
          prefill: { email: payload.userEmail, name: payload.userName },
          theme: { color: "#8b7fff" },
          handler: async () => {
            const pending = state.pendingPlatformSetup;
            if (pending) {
              try {
                if (pending.platform === "telegram") {
                  await api(`/api/businesses/${encodeURIComponent(biz.id)}/telegram`, { method: "POST", body: { token: pending.token } });
                } else {
                  await api(`/api/businesses/${encodeURIComponent(biz.id)}`, { method: "PATCH", body: pending.config });
                }
              } catch (err) { /* ignore */ }
            }
            await loadBootstrap(biz.id);
            state.showPaymentPopup = false;
            state.pendingPlatformSetup = null;
            state.showBotLivePopup = true;
            state.billingActivated = true;
            render();
          }
        });
        rzp.open();
      }
    } catch (err) { alert(err.message); if (btn) { btn.disabled = false; btn.textContent = "🇮🇳 Pay ₹2,999/mo"; } }
  });

  // Stripe payment
  document.querySelector("#setup-stripe-btn")?.addEventListener("click", async () => {
    const btn = document.querySelector("#setup-stripe-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Redirecting..."; }
    try {
      // Save pending setup to sessionStorage for after redirect
      if (state.pendingPlatformSetup) {
        sessionStorage.setItem("pendingPlatformSetup", JSON.stringify(state.pendingPlatformSetup));
      }
      const payload = await api(`/api/businesses/${encodeURIComponent(biz.id)}/billing/checkout`, { method: "POST", body: { plan: "pro" } });
      if (payload.url) window.location.href = payload.url;
    } catch (err) { alert(err.message); if (btn) { btn.disabled = false; btn.textContent = "🌍 Pay $49/mo"; } }
  });
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
      // If returning from Stripe after payment, apply any pending platform setup
      if (pageParams.get("billing") === "success") {
        state.billingActivated = true;
        const pending = (() => { try { return JSON.parse(sessionStorage.getItem("pendingPlatformSetup") || "null"); } catch { return null; } })();
        if (pending && state.selectedBusiness?.id) {
          sessionStorage.removeItem("pendingPlatformSetup");
          try {
            if (pending.platform === "telegram") {
              await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}/telegram`, { method: "POST", body: { token: pending.token } });
            } else if (pending.platform === "whatsapp") {
              await api(`/api/businesses/${encodeURIComponent(state.selectedBusiness.id)}`, { method: "PATCH", body: pending.config });
            }
            await loadBootstrap(state.selectedBusiness.id);
            state.showBotLivePopup = true;
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
