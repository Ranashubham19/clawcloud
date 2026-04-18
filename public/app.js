const app = document.querySelector("#app");
const pageParams = new URLSearchParams(window.location.search);
const dashboardTabs = new Set(["overview", "leads", "chats", "bookings", "billing", "team", "apikeys", "audit", "analytics", "settings", "admin"]);

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
  authMode: pageParams.get("mode") === "login" ? "login" : "signup",
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
  telegramSetup: false
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
              <img src="/logo.svg" class="logo-img" alt="ClawCloud" width="32" height="32" />
              <span class="logo-name">ClawCloud</span>
            </div>
            <div class="nav-links">
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
              <a href="/privacy">Privacy</a>
            </div>
            <div class="nav-actions">
              <a class="ghost-button" href="/app?mode=login">Log in</a>
              <a class="button" href="/app?mode=signup">Get started free</a>
            </div>
          </div>
        </div>
      </nav>

      <!-- HERO -->
      <section class="lp-hero">
        <div class="shell">
          <div class="lp-hero-inner">
            <span class="eyebrow">AI Bot Platform for Businesses</span>
            <h1 class="lp-h1">One AI. Every platform.<br>Zero manual work.</h1>
            <p class="lp-sub">ClawCloud gives your business an AI-powered assistant that captures leads, books demos, answers FAQs, and delivers real-time insights — on WhatsApp and Telegram.</p>
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
              <h3>Instant Lead Capture</h3>
              <p>Name, phone, course interest, and preferred timing — captured automatically the moment a customer messages you on WhatsApp.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">📅</div>
              <h3>Demo Booking Flow</h3>
              <p>The AI handles the full booking conversation, records the slot, and stores it in your dashboard — zero manual effort.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🤖</div>
              <h3>Custom AI per Workspace</h3>
              <p>Each business gets its own AI prompt, FAQ library, WhatsApp number, and brand voice — fully isolated and configurable.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">📊</div>
              <h3>Real-time Analytics</h3>
              <p>Track leads, conversations, demo requests, and conversion rates from a single premium dashboard updated in real time.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">👥</div>
              <h3>Team Collaboration</h3>
              <p>Invite team members, assign roles, and manage permissions — everyone works from the same live data without stepping on each other.</p>
            </div>
            <div class="lp-feature-card">
              <div class="lp-feature-icon">🔒</div>
              <h3>Secure & Compliant</h3>
              <p>End-to-end encrypted sessions, rate limiting, audit logs, and GDPR-ready data deletion — enterprise-grade security out of the box.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- PRICING -->
      <section class="lp-section lp-pricing-section" id="pricing">
        <div class="shell">
          <div class="lp-section-header">
            <span class="eyebrow">Simple Pricing</span>
            <h2 class="lp-h2">Transparent plans.<br>No hidden fees.</h2>
            <p class="lp-section-sub">Pay in INR or USD. Cancel anytime. Upgrade or downgrade as you grow.</p>
          </div>
          <div class="lp-pricing-grid">
            ${state.plans.map((plan, i) => `
              <div class="lp-pricing-card ${i === 1 ? "lp-pricing-card--featured" : ""}">
                ${i === 1 ? `<div class="lp-pricing-badge">Most Popular</div>` : ""}
                <div class="lp-pricing-name">${escapeHtml(plan.name)}</div>
                <div class="lp-pricing-amount">
                  <span class="lp-pricing-inr">₹${escapeHtml(String(plan.priceInr))}</span>
                  <span class="lp-pricing-period">/month</span>
                </div>
                <div class="lp-pricing-usd">or $${escapeHtml(String(plan.priceUsd || ""))}/mo for international</div>
                <p class="lp-pricing-desc">${escapeHtml(plan.summary)}</p>
                <a class="button ${i === 1 ? "" : "ghost-button"}" href="/app?mode=signup" style="width:100%;text-align:center;display:block;">Get started</a>
              </div>
            `).join("")}
          </div>
        </div>
      </section>

      <!-- CTA BANNER -->
      <section class="lp-cta-banner">
        <div class="shell">
          <div class="lp-cta-banner-inner">
            <h2 class="lp-h2" style="color:#fff;">Ready to automate your business conversations?</h2>
            <p style="color:rgba(255,255,255,0.65);margin:12px 0 28px;font-size:1rem;">Set up your AI assistant on WhatsApp or Telegram in under 5 minutes. No technical skills required.</p>
            <a class="button lp-cta-btn" href="/app?mode=signup">Create your free workspace →</a>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="lp-footer">
        <div class="shell">
          <div class="lp-footer-inner">
            <div class="logo">
              <img src="/logo.svg" class="logo-img" alt="ClawCloud" width="32" height="32" />
              <span class="logo-name">ClawCloud</span>
            </div>
            <div class="lp-footer-links">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="/data-deletion">Data Deletion</a>
              <a href="/app?mode=login">Dashboard</a>
            </div>
            <div class="lp-footer-copy">© 2026 ClawCloud. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  `;
}

function renderAuth() {
  const isSignup = state.authMode === "signup";
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-left">
        <a class="logo" href="/">
          <img src="/logo.svg" class="logo-img" alt="ClawCloud" width="28" height="28" />
          <span class="logo-name">ClawCloud</span>
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
        <div class="auth-left-footer">© 2026 ClawCloud · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>
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
            <form id="signup-form">
              <div class="field">
                <label>Full name</label>
                <input class="input" name="name" placeholder="Shubham Rana" required />
              </div>
              <div class="field">
                <label>Business name</label>
                <input class="input" name="businessName" placeholder="ClawCloud Inc." required />
              </div>
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" name="email" placeholder="you@example.com" required />
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" name="password" placeholder="Minimum 8 characters" required />
              </div>
              <div class="form-actions">
                <button class="button" type="submit" style="width:100%;justify-content:center;">Create account →</button>
              </div>
            </form>
          ` : `
            <form id="login-form">
              <div class="field">
                <label>Email</label>
                <input class="input" type="email" name="email" placeholder="you@example.com" required />
              </div>
              <div class="field">
                <label>Password</label>
                <input class="input" type="password" name="password" placeholder="Your password" required />
              </div>
              <div class="form-actions">
                <button class="button" type="submit" style="width:100%;justify-content:center;">Log in →</button>
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

  const signupForm = document.querySelector("#signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = formToObject(signupForm);
        await api("/api/auth/signup", { method: "POST", body: payload });
        await loadBootstrap(pageParams.get("businessId") || "");
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = formToObject(loginForm);
        await api("/api/auth/login", { method: "POST", body: payload });
        await loadBootstrap(pageParams.get("businessId") || "");
        render();
      } catch (error) {
        alert(error.message);
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
          <div class="section-header">
            <div>
              <div class="page-title">Billing & Subscription</div>
              <div class="muted">Manage your plan and payment method</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="ghost-button" type="button" id="billing-refresh">Refresh</button>
              ${state.billingEnabled && billing.stripeCustomerId
                ? `<button class="button" type="button" id="billing-portal">Billing portal</button>`
                : ""}
            </div>
          </div>
          ${state.billingNotice ? `
            <div class="notice ${escapeHtml(state.billingNotice.tone)}">${escapeHtml(state.billingNotice.message)}</div>
          ` : ""}
          <div class="info-grid">
            <div class="info-tile">
              <div class="info-tile-label">Current Plan</div>
              <div class="info-tile-value">${escapeHtml(String(currentPlan).charAt(0).toUpperCase() + String(currentPlan).slice(1))}</div>
            </div>
            <div class="info-tile">
              <div class="info-tile-label">Billing Status</div>
              <div class="info-tile-value">
                <span class="status-badge ${activeBilling ? "ok" : "warn"}">${escapeHtml(billing.status || "Inactive")}</span>
              </div>
            </div>
            <div class="info-tile">
              <div class="info-tile-label">Period Ends</div>
              <div class="info-tile-value">${escapeHtml(billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "—")}</div>
            </div>
            <div class="info-tile">
              <div class="info-tile-label">Customer ID</div>
              <div class="info-tile-value">${escapeHtml(billing.stripeCustomerId || billing.razorpaySubscriptionId || "Not created")}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Choose a Plan</div>
            <div class="plan-stack">
              ${state.plans.map((plan) => {
                const isCurrentPlan = String(plan.id) === String(currentPlan);
                let actionMarkup = `<button class="ghost-button" type="button" disabled>Billing not configured</button>`;

                if (state.billingEnabled) {
                  if (isCurrentPlan && activeBilling) {
                    actionMarkup = `<span class="status-badge ok">Active subscription</span>`;
                  } else {
                    actionMarkup = `
                      <div class="payment-buttons">
                        <button class="button razorpay-btn" type="button" data-upgrade-plan="${escapeHtml(plan.id)}" data-provider="razorpay">
                          🇮🇳 Pay ₹${escapeHtml(String(plan.priceInr))}/mo
                        </button>
                        <button class="button stripe-btn" type="button" data-upgrade-plan="${escapeHtml(plan.id)}" data-provider="stripe">
                          🌍 Pay $${escapeHtml(String(plan.priceUsd || ""))}/mo
                        </button>
                      </div>
                    `;
                  }
                }

                return `
                  <article class="plan-card">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px;">
                      <div style="flex:1;min-width:0;">
                        <h3>${escapeHtml(plan.name)}${isCurrentPlan ? ` <span class="pill" style="margin-left:8px;">Current</span>` : ""}</h3>
                        <p class="plan-summary">${escapeHtml(plan.summary)}</p>
                      </div>
                      <div style="text-align:right;flex-shrink:0;">
                        <div class="plan-price-inr">₹${escapeHtml(String(plan.priceInr))}<span>/mo</span></div>
                        <div class="plan-price-usd">$${escapeHtml(String(plan.priceUsd || ""))}/mo</div>
                      </div>
                    </div>
                    <div class="plan-actions">
                      ${actionMarkup}
                    </div>
                  </article>
                `;
              }).join("")}
            </div>
          </div>
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
      return `
        <section class="card">
          <h2 class="section-title">Business settings</h2>
          <form id="settings-form" class="section">
            <div class="split">
              <div class="field">
                <label>Institute name</label>
                <input class="input" name="name" value="${escapeHtml(state.selectedBusiness?.name || "")}" required />
              </div>
              <div class="field">
                <label>Support email</label>
                <input class="input" type="email" name="supportEmail" value="${escapeHtml(state.selectedBusiness?.supportEmail || "")}" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Website</label>
                <input class="input" name="website" value="${escapeHtml(state.selectedBusiness?.website || "")}" />
              </div>
              <div class="field">
                <label>Plan</label>
                <select class="select" name="plan">
                  ${state.plans.map((plan) => `
                    <option value="${escapeHtml(plan.id)}" ${state.selectedBusiness?.plan === plan.id ? "selected" : ""}>${escapeHtml(plan.name)}</option>
                  `).join("")}
                </select>
              </div>
            </div>
            <div class="field">
              <label>Description</label>
              <textarea class="textarea" name="description">${escapeHtml(state.selectedBusiness?.description || "")}</textarea>
            </div>
            <div class="split">
              <div class="field">
                <label>Messaging provider</label>
                <select class="select" name="whatsappProvider">
                  <option value="aisensy" ${(state.selectedBusiness?.whatsapp?.provider || "aisensy") === "aisensy" ? "selected" : ""}>AiSensy</option>
                  <option value="meta" ${state.selectedBusiness?.whatsapp?.provider === "meta" ? "selected" : ""}>Meta Cloud API</option>
                </select>
                <small>AiSensy uses the shared server-level AiSensy credentials. Meta uses the business token and phone fields below.</small>
              </div>
              <div class="field">
                <label>WhatsApp display number</label>
                <input class="input" name="whatsappDisplayPhoneNumber" value="${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || "")}" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>WhatsApp phone number ID</label>
                <input class="input" name="whatsappPhoneNumberId" value="${escapeHtml(state.selectedBusiness?.whatsapp?.phoneNumberId || "")}" />
              </div>
              <div class="field">
                <label>Business account ID</label>
                <input class="input" name="whatsappBusinessAccountId" value="${escapeHtml(state.selectedBusiness?.whatsapp?.businessAccountId || "")}" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label>Access token</label>
                <input class="input" name="whatsappAccessToken" value="${escapeHtml(state.selectedBusiness?.whatsapp?.accessToken || "")}" />
              </div>
              <div class="field"></div>
            </div>
            <div class="field">
              <label>AI prompt</label>
              <textarea class="textarea" name="aiPrompt">${escapeHtml(state.selectedBusiness?.aiPrompt || "")}</textarea>
            </div>
            <div class="field">
              <label>Welcome message</label>
              <textarea class="textarea" name="welcomeMessage">${escapeHtml(state.selectedBusiness?.welcomeMessage || "")}</textarea>
            </div>
            <div class="field">
              <label>FAQs</label>
              <textarea class="textarea" name="faqText">${escapeHtml(serializeFaqs(state.selectedBusiness?.faqItems || []))}</textarea>
              <small>One FAQ per line: Question | Answer</small>
            </div>
            <div class="field">
              <label>Courses</label>
              <textarea class="textarea" name="courseText">${escapeHtml(serializeCourses(state.selectedBusiness?.courseItems || []))}</textarea>
              <small>One course per line: Course | Timings comma-separated | Fee | Keywords comma-separated | Description</small>
            </div>
            <div class="form-actions">
              <button class="button" type="submit">Save settings</button>
            </div>
          </form>
        </section>

        <section class="card" style="margin-top:20px;">
          <h2 class="section-title">Telegram Bot</h2>
          ${state.selectedBusiness?.telegram?.token ? `
            <div class="tg-connected-banner">
              <div style="display:flex;align-items:center;gap:10px;">
                <svg width="24" height="24" viewBox="0 0 52 52" fill="none"><rect width="52" height="52" rx="14" fill="#229ED9"/><path d="M38.94 14.29L33.6 38.35c-.38 1.7-1.4 2.12-2.83 1.32l-7.8-5.74-3.76 3.63c-.42.42-.77.77-1.57.77l.56-7.95 14.42-13.02c.63-.56-.14-.87-.97-.31L12.37 29.6l-7.67-2.4c-1.67-.52-1.7-1.67.35-2.47l30-11.56c1.39-.5 2.6.34 1.89 2.12z" fill="white"/></svg>
                <div>
                  <strong>@${escapeHtml(state.selectedBusiness.telegram.botUsername || "")}</strong> is connected and live
                  <div class="muted" style="font-size:0.8rem;">Students can message this bot on Telegram and your AI will reply instantly</div>
                </div>
              </div>
              <button class="ghost-button" id="tg-disconnect-settings-btn" style="color:#e53e3e;">Disconnect</button>
            </div>
          ` : `
            <p class="muted" style="margin-bottom:16px;">Connect a Telegram bot so your AI can reply to students on Telegram too.</p>
            <div id="tg-settings-error" class="form-error" style="display:none;margin-bottom:12px;"></div>
            <form id="tg-settings-form" class="section">
              <div class="field">
                <label>BotFather Token</label>
                <input class="input" id="tg-settings-token" placeholder="1234567890:ABCdefGHIjklMNO..." />
                <small>Get this from @BotFather on Telegram → /newbot</small>
              </div>
              <div class="form-actions">
                <button class="button" type="submit" id="tg-settings-btn">Connect Telegram Bot</button>
              </div>
            </form>
          `}
        </section>
      `;
    default:
      return `
        <section class="card">
          <div class="section-header">
            <div>
              <div class="page-title">Overview</div>
              <div class="muted">Your workspace at a glance</div>
            </div>
          </div>
          <div class="metrics-grid">
            <div class="metric">
              <div class="metric-label">Total Leads</div>
              <div class="metric-value">${escapeHtml(String(state.analytics?.totalLeads || 0))}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Qualified</div>
              <div class="metric-value">${escapeHtml(String(state.analytics?.qualifiedLeads || 0))}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Demo Requests</div>
              <div class="metric-value">${escapeHtml(String(state.analytics?.demoRequested || 0))}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Chats</div>
              <div class="metric-value">${escapeHtml(String(state.analytics?.totalChats || 0))}</div>
            </div>
          </div>
          <div class="section split">
            <div class="card">
              <h3 class="section-title">Launch readiness</h3>
              <div class="metric-value">${escapeHtml(`${readiness.score || 0}/${readiness.total || 0}`)}</div>
              <div class="muted">How close this institute is to a clean live launch.</div>
              <div class="status-list section">
                ${(readiness.items || []).map((item) => `
                  <div class="status-row">
                    <span>${escapeHtml(item.label)}</span>
                    <span class="status-badge ${item.ok ? "ok" : "warn"}">${item.ok ? "Ready" : "Needs action"}</span>
                  </div>
                `).join("") || `<div class="empty">No readiness checks yet.</div>`}
              </div>
            </div>
            <div class="card">
              <h3 class="section-title">Workspace snapshot</h3>
              <div class="status-list">
                <div class="status-row">
                  <span class="muted">Current plan</span>
                  <span>${escapeHtml(String(currentPlan).toUpperCase())}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Billing status</span>
                  <span class="status-badge ${activeBilling ? "ok" : "warn"}">${escapeHtml(billing.status || "inactive")}</span>
                </div>
                <div class="status-row">
                  <span class="muted">WhatsApp display number</span>
                  <span>${escapeHtml(state.selectedBusiness?.whatsapp?.displayPhoneNumber || "Not linked yet")}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Support email</span>
                  <span>${escapeHtml(state.selectedBusiness?.supportEmail || state.user?.email || "-")}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="section split">
            <div class="card">
              <h3 class="section-title">Recent leads</h3>
              ${(state.leads || []).slice(0, 5).map((lead) => `
                <div class="chat-thread">
                  <strong>${escapeHtml(lead.name || lead.phone)}</strong>
                  <div class="muted">${escapeHtml(lead.courseInterest || "Course not captured yet")}</div>
                  <div class="pill">${escapeHtml(lead.status || "new")}</div>
                </div>
              `).join("") || `<div class="empty">No recent leads yet.</div>`}
            </div>
            <div class="card">
              <h3 class="section-title">Recent chats</h3>
              ${(state.chats || []).slice(0, 5).map((chat) => `
                <div class="chat-thread">
                  <strong>${escapeHtml(chat.contact?.name || chat.chatId)}</strong>
                  <div class="muted">${escapeHtml(chat.lastMessage?.text || "No reply yet")}</div>
                </div>
              `).join("") || `<div class="empty">No chats stored yet.</div>`}
            </div>
          </div>
        </section>
      `;
  }
}

function needsOnboarding() {
  if (state.onboardingDone) return false;
  const biz = state.selectedBusiness;
  if (!biz) return false;
  const hasCourses = (biz.courseItems || []).length > 0;
  const hasFaqs = (biz.faqItems || []).length > 0;
  return !hasCourses && !hasFaqs;
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
  app.innerHTML = `
    <main class="app-shell">
      <div class="shell">
        <div class="app-topbar">
          <div class="topbar-left">
            <div class="logo">
              <img src="/logo.svg" class="logo-img" alt="ClawCloud" width="32" height="32" />
              <span class="logo-name">ClawCloud</span>
            </div>
            ${state.selectedBusiness?.name ? `<span class="topbar-biz-name">${escapeHtml(state.selectedBusiness.name)}</span>` : ""}
          </div>
          <div class="inline-actions">
            <button class="ghost-button" id="create-business">Add institute</button>
            <button class="ghost-button" id="refresh-dashboard">Refresh</button>
            <button class="danger-button" id="logout-button">Log out</button>
          </div>
        </div>

        <section class="dashboard-grid">
          <aside class="sidebar">
            <div class="sidebar-biz-card">
              <div class="sidebar-biz-label">Active institute</div>
              <div class="sidebar-biz-name">${escapeHtml(state.selectedBusiness?.name || "—")}</div>
              ${(state.userBusinesses || []).length > 1 ? `
                <select id="business-switcher" class="sidebar-biz-switcher">
                  ${(state.userBusinesses || []).map((business) => `
                    <option value="${escapeHtml(business.id)}" ${business.id === state.selectedBusiness?.id ? "selected" : ""}>${escapeHtml(business.name)}</option>
                  `).join("")}
                </select>
              ` : ""}
              <div class="sidebar-biz-meta">
                <span class="pill">${escapeHtml(state.selectedBusiness?.plan || "basic")} plan</span>
                <span class="sidebar-biz-readiness">Readiness: ${escapeHtml(`${state.readiness?.score || 0}/${state.readiness?.total || 0}`)}</span>
              </div>
            </div>

            <div class="sidebar-section-label">Main</div>
            <button class="tab-button ${state.tab === "overview" ? "active" : ""}" data-tab="overview">📊 Overview</button>
            <button class="tab-button ${state.tab === "analytics" ? "active" : ""}" data-tab="analytics">📈 Analytics</button>
            <button class="tab-button ${state.tab === "leads" ? "active" : ""}" data-tab="leads">👥 Leads</button>
            <button class="tab-button ${state.tab === "chats" ? "active" : ""}" data-tab="chats">💬 Chats</button>
            <button class="tab-button ${state.tab === "bookings" ? "active" : ""}" data-tab="bookings">📅 Bookings</button>
            <div class="sidebar-section-label">Account</div>
            <button class="tab-button ${state.tab === "team" ? "active" : ""}" data-tab="team">🤝 Team</button>
            <button class="tab-button ${state.tab === "apikeys" ? "active" : ""}" data-tab="apikeys">🔑 API Keys</button>
            <button class="tab-button ${state.tab === "audit" ? "active" : ""}" data-tab="audit">📋 Audit Log</button>
            <button class="tab-button ${state.tab === "billing" ? "active" : ""}" data-tab="billing">💳 Billing</button>
            <button class="tab-button ${state.tab === "settings" ? "active" : ""}" data-tab="settings">⚙️ Settings</button>
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
  app.innerHTML = `
    <div class="tg-setup-page">
      <div class="tg-setup-left">
        <a class="logo" href="/">
          <img src="/logo.svg" class="logo-img" alt="ClawCloud" width="28" height="28" />
          <span class="logo-name">ClawCloud</span>
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
          ${bot?.token ? `
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
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        if (!state.selectedBusiness) state.selectedBusiness = {};
        state.selectedBusiness.telegram = { token, botUsername: res.bot?.username || "", botName: res.bot?.name || "" };
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
    if (state.selectedBusiness) state.selectedBusiness.telegram = {};
    renderTelegramSetup();
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
    renderAuth();
    return;
  }

  if (state.telegramSetup) {
    renderTelegramSetup();
    return;
  }

  if (state.selectedProduct === "telegram" && state.user && !state.selectedBusiness?.telegram?.token) {
    renderTelegramSetup();
    return;
  }

  if (needsOnboarding() || (state.showOnboarding && state.onboardingStep > 0)) {
    if (!state.onboardingStep) state.onboardingStep = 1;
    renderOnboarding();
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
