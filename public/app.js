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
  authSubMode: ""
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
  if (!amount) {
    return "Custom";
  }
  return `Rs ${amount.toLocaleString("en-IN")}`;
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
    <main class="hero">
      <div class="shell">
        <div class="hero-topbar">
          <div class="logo">
            <span class="logo-mark"></span>
            <span>Claw Cloud</span>
          </div>
          <div class="inline-actions">
            <a class="ghost-button" href="/app?mode=login">Log in</a>
            <a class="button" href="/app?mode=signup">Launch dashboard</a>
          </div>
        </div>

        <section class="hero-grid">
          <article class="hero-card">
            <span class="eyebrow">WhatsApp AI for coaching institutes</span>
            <h1>Turn WhatsApp inquiries into booked demos and qualified leads.</h1>
            <p class="hero-copy">
              This SaaS sits on top of your existing WhatsApp AI engine and gives every institute
              its own prompt, own number, own lead pipeline, own demo-booking flow, and a clean operator dashboard.
            </p>
            <div class="hero-actions">
              <a class="button" href="/app?mode=signup">Create your institute workspace</a>
              <a class="ghost-button" href="/app?mode=login">Sign in</a>
            </div>
            <div class="section hero-stats">
              <div class="metric">
                <div class="muted">Faster replies</div>
                <div class="metric-value">&lt; 1 min</div>
              </div>
              <div class="metric">
                <div class="muted">Lead fields tracked</div>
                <div class="metric-value">4 core</div>
              </div>
              <div class="metric">
                <div class="muted">Institutes per owner</div>
                <div class="metric-value">Multi</div>
              </div>
              <div class="metric">
                <div class="muted">MVP modules</div>
                <div class="metric-value">5</div>
              </div>
            </div>
          </article>

          <aside class="hero-card">
            <h3 class="section-title">Built for the exact coaching flow</h3>
            <div class="feature-grid">
              <div class="feature">
                <h3>Lead capture</h3>
                <p class="muted">Name, phone, course interest, and timing are tracked automatically from WhatsApp.</p>
              </div>
              <div class="feature">
                <h3>Demo booking</h3>
                <p class="muted">When a student asks for a demo, the system records the intent and stores the requested slot.</p>
              </div>
              <div class="feature">
                <h3>Institute AI</h3>
                <p class="muted">Each business keeps its own FAQs, courses, prompt, and WhatsApp number.</p>
              </div>
            </div>
            <section class="section">
              <h3 class="section-title">Plans</h3>
              <div class="plan-grid">
                ${state.plans.map((plan) => `
                  <div class="plan">
                    <span class="pill">${escapeHtml(plan.name)}</span>
                    <h3>${escapeHtml(plan.name)}</h3>
                    <div class="metric-value">${escapeHtml(formatPlanPrice(plan.priceInr))}</div>
                    <p class="muted">${escapeHtml(plan.summary)}</p>
                  </div>
                `).join("")}
              </div>
            </section>
          </aside>
        </section>
        <div class="footer">Professional WhatsApp automation for admissions, follow-ups, and demo conversion.</div>
      </div>
    </main>
  `;
}

function renderAuth() {
  app.innerHTML = `
    <main class="app-shell">
      <div class="shell" style="max-width:480px">
        <div class="app-topbar">
          <a class="logo" href="/">
            <span class="logo-mark"></span>
            <span>Claw Cloud</span>
          </a>
        </div>

        <section class="auth-card" style="border:1px solid rgba(124,111,255,0.2);background:rgba(124,111,255,0.04);">
          <h2 style="margin:0 0 6px;font-size:1.6rem;font-weight:800;">${state.authMode === "signup" ? "Create your account" : "Welcome back"}</h2>
          <p class="muted" style="margin:0 0 24px;font-size:0.92rem;">Your AI assistant on WhatsApp — set up in 2 minutes.</p>

          <a class="google-button" href="/api/auth/google">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.6-7.7 19.6-20 0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4c-7.8 0-14.5 4.3-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.5 5C9.4 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.8 6l6.2 5.2C40.7 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
            Continue with Google
          </a>

          <div class="divider">or</div>

          <div class="tab-row" style="margin-bottom:20px;">
            <button class="tab-button ${state.authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button>
            <button class="tab-button ${state.authMode === "login" ? "active" : ""}" data-auth-mode="login">Log in</button>
          </div>

          ${state.authMode === "signup" ? `
            <form id="signup-form">
              <div class="field">
                <label>Your name</label>
                <input class="input" name="name" placeholder="Shubham Rana" required />
              </div>
              <div class="field">
                <label>Business name</label>
                <input class="input" name="businessName" placeholder="Claw Cloud Inc." required />
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
        </section>
      </div>
    </main>
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
          <h2 class="section-title">Billing</h2>
          ${state.billingNotice ? `
            <div class="notice ${escapeHtml(state.billingNotice.tone)}">${escapeHtml(state.billingNotice.message)}</div>
          ` : ""}
          <div class="metrics-grid">
            <div class="metric">
              <div class="muted">Current plan</div>
              <div class="metric-value">${escapeHtml(String(currentPlan).toUpperCase())}</div>
            </div>
            <div class="metric">
              <div class="muted">Billing status</div>
              <div class="metric-value">${escapeHtml(billing.status || "inactive")}</div>
            </div>
            <div class="metric">
              <div class="muted">Period end</div>
              <div class="metric-value">${escapeHtml(billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "-")}</div>
            </div>
            <div class="metric">
              <div class="muted">Stripe customer</div>
              <div class="metric-value">${escapeHtml(billing.stripeCustomerId || "Not created")}</div>
            </div>
          </div>
          <div class="section plan-stack">
            ${state.plans.map((plan) => {
              const isCurrentPlan = String(plan.id) === String(currentPlan);
              let actionMarkup = `<button class="ghost-button" type="button" disabled>Billing not configured</button>`;

              if (state.billingEnabled) {
                if (isCurrentPlan && activeBilling) {
                  actionMarkup = `<button class="ghost-button" type="button" disabled>Current subscription</button>`;
                } else {
                  actionMarkup = `
                    <div class="payment-buttons">
                      <button class="button razorpay-btn" type="button" data-upgrade-plan="${escapeHtml(plan.id)}" data-provider="razorpay">
                        Pay ₹${escapeHtml(String(plan.priceInr))}/mo
                      </button>
                      <button class="button stripe-btn" type="button" data-upgrade-plan="${escapeHtml(plan.id)}" data-provider="stripe">
                        Pay $${escapeHtml(String(plan.priceUsd || ""))}/mo
                      </button>
                    </div>
                  `;
                }
              }

              return `
                <article class="plan-card">
                  <div class="status-row">
                    <div>
                      <h3>${escapeHtml(plan.name)}</h3>
                      <div class="muted">${escapeHtml(plan.summary)}</div>
                    </div>
                    <div>
                      <div class="metric-value">₹${escapeHtml(String(plan.priceInr))}<span class="muted">/mo</span></div>
                      <div class="muted" style="text-align:right">$${escapeHtml(String(plan.priceUsd || ""))}/mo</div>
                    </div>
                  </div>
                  <div class="plan-actions">
                    ${isCurrentPlan ? `<span class="pill">Current plan</span>` : `<span class="pill">${escapeHtml(plan.id)}</span>`}
                    ${actionMarkup}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
          <div class="section split">
            <div class="card">
              <h3 class="section-title">Subscription controls</h3>
              <div class="status-list">
                <div class="status-row">
                  <span class="muted">Stripe enabled</span>
                  <span class="status-badge ${state.billingEnabled ? "ok" : "warn"}">${state.billingEnabled ? "Ready" : "Disabled"}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Portal access</span>
                  <span class="status-badge ${billing.stripeCustomerId ? "ok" : "warn"}">${billing.stripeCustomerId ? "Available" : "Needs checkout first"}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Cancel at period end</span>
                  <span>${escapeHtml(billing.cancelAtPeriodEnd === true ? "Yes" : "No")}</span>
                </div>
              </div>
              <div class="form-actions">
                <button class="ghost-button" type="button" id="billing-refresh">Refresh billing</button>
                ${state.billingEnabled && billing.stripeCustomerId
                  ? `<button class="button" type="button" id="billing-portal">Open billing portal</button>`
                  : ""}
              </div>
            </div>
            <div class="card">
              <h3 class="section-title">Commercial notes</h3>
              <div class="status-list">
                <div class="status-row">
                  <span class="muted">Plan stored on workspace</span>
                  <span>${escapeHtml(state.selectedBusiness?.plan || "basic")}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Billing provider</span>
                  <span>${escapeHtml(billing.provider || "stripe")}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Last checkout</span>
                  <span>${escapeHtml(billing.lastCheckoutAt ? formatDate(billing.lastCheckoutAt) : "-")}</span>
                </div>
                <div class="status-row">
                  <span class="muted">Last webhook</span>
                  <span>${escapeHtml(billing.lastWebhookAt ? formatDate(billing.lastWebhookAt) : "-")}</span>
                </div>
              </div>
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
      `;
    default:
      return `
        <section class="card">
          <h2 class="section-title">Overview</h2>
          <div class="metrics-grid">
            <div class="metric">
              <div class="muted">Total leads</div>
              <div class="metric-value">${escapeHtml(state.analytics?.totalLeads || 0)}</div>
            </div>
            <div class="metric">
              <div class="muted">Qualified leads</div>
              <div class="metric-value">${escapeHtml(state.analytics?.qualifiedLeads || 0)}</div>
            </div>
            <div class="metric">
              <div class="muted">Demo requested</div>
              <div class="metric-value">${escapeHtml(state.analytics?.demoRequested || 0)}</div>
            </div>
            <div class="metric">
              <div class="muted">Chats tracked</div>
              <div class="metric-value">${escapeHtml(state.analytics?.totalChats || 0)}</div>
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

function renderDashboard() {
  app.innerHTML = `
    <main class="app-shell">
      <div class="shell">
        <div class="app-topbar">
          <div class="logo">
            <span class="logo-mark"></span>
            <span>${escapeHtml(state.selectedBusiness?.name || "Claw Cloud")}</span>
          </div>
          <div class="inline-actions">
            <button class="ghost-button" id="create-business">Add institute</button>
            <button class="ghost-button" id="refresh-dashboard">Refresh</button>
            <button class="danger-button" id="logout-button">Log out</button>
          </div>
        </div>

        <section class="dashboard-grid">
          <aside class="sidebar">
            <div class="card">
              <div class="field">
                <label>Active institute</label>
                <select id="business-switcher" class="select">
                  ${(state.userBusinesses || []).map((business) => `
                    <option value="${escapeHtml(business.id)}" ${business.id === state.selectedBusiness?.id ? "selected" : ""}>${escapeHtml(business.name)}</option>
                  `).join("")}
                </select>
              </div>
              <div class="pill">${escapeHtml(state.selectedBusiness?.plan || "basic")} plan</div>
              <div class="muted">Readiness: ${escapeHtml(`${state.readiness?.score || 0}/${state.readiness?.total || 0}`)}</div>
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
            const rzp = new window.Razorpay({
              key: payload.keyId,
              subscription_id: payload.subscriptionId,
              name: payload.businessName || "Claw Cloud",
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
