import { config } from "./config.js";

const COMPANY = "Claw Cloud";
const CONTACT_EMAIL = "ranashubham8988@gmail.com";
const WEBSITE = "https://www.swift-deploy.in";
const EFFECTIVE_DATE = "April 17, 2026";

function renderPage({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — ${COMPANY}</title>
    <meta name="description" content="${description || title}" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --bg: #0a0a0f;
        --bg-2: #0f0f18;
        --panel: rgba(255,255,255,0.04);
        --ink: #f0f0fa;
        --muted: #7a7a9a;
        --line: rgba(255,255,255,0.08);
        --brand: #7c6fff;
        --brand-soft: rgba(124,111,255,0.12);
        --green: #00e5a0;
        --radius: 20px;
      }

      html, body {
        background: var(--bg);
        color: var(--ink);
        font-family: "Inter", "Segoe UI", system-ui, sans-serif;
        font-size: 16px;
        line-height: 1.7;
        -webkit-font-smoothing: antialiased;
        min-height: 100vh;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        background:
          radial-gradient(ellipse 80% 50% at 20% -10%, rgba(124,111,255,0.1), transparent),
          radial-gradient(ellipse 60% 40% at 80% 110%, rgba(0,229,160,0.05), transparent);
        pointer-events: none;
        z-index: 0;
      }

      .wrap {
        max-width: 780px;
        margin: 0 auto;
        padding: 40px 24px 80px;
        position: relative;
        z-index: 1;
      }

      /* NAV */
      nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 0 48px;
      }

      .logo {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-weight: 800;
        font-size: 1rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink);
        text-decoration: none;
      }

      .logo-mark {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, #7c6fff, #5b4fff);
        box-shadow: 0 6px 20px rgba(124,111,255,0.4);
      }

      .nav-link {
        color: var(--muted);
        text-decoration: none;
        font-size: 0.9rem;
        font-weight: 500;
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: var(--panel);
        transition: all 0.2s;
      }

      .nav-link:hover {
        color: var(--ink);
        border-color: rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.07);
      }

      /* HEADER */
      .doc-header {
        margin-bottom: 48px;
        padding-bottom: 32px;
        border-bottom: 1px solid var(--line);
      }

      .doc-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        border-radius: 999px;
        background: var(--brand-soft);
        border: 1px solid rgba(124,111,255,0.25);
        color: var(--brand);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 20px;
      }

      .doc-title {
        font-size: clamp(2rem, 5vw, 3rem);
        font-weight: 900;
        line-height: 1.1;
        background: linear-gradient(135deg, #fff 40%, var(--brand));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 14px;
      }

      .doc-meta {
        color: var(--muted);
        font-size: 0.88rem;
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
      }

      .doc-meta span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      /* CONTENT */
      .doc-body h2 {
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--ink);
        margin: 40px 0 14px;
        padding-top: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .doc-body h2::before {
        content: "";
        display: inline-block;
        width: 4px;
        height: 18px;
        background: linear-gradient(180deg, var(--brand), var(--green));
        border-radius: 2px;
        flex-shrink: 0;
      }

      .doc-body p {
        color: #c0c0d8;
        margin-bottom: 14px;
        font-size: 0.97rem;
      }

      .doc-body ul, .doc-body ol {
        padding-left: 0;
        list-style: none;
        display: grid;
        gap: 8px;
        margin-bottom: 16px;
      }

      .doc-body li {
        color: #c0c0d8;
        font-size: 0.95rem;
        padding: 12px 16px;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding-left: 42px;
        position: relative;
      }

      .doc-body li::before {
        content: "→";
        position: absolute;
        left: 16px;
        color: var(--brand);
        font-weight: 700;
      }

      .doc-body a {
        color: var(--brand);
        text-decoration: none;
        border-bottom: 1px solid rgba(124,111,255,0.3);
        transition: border-color 0.2s;
      }

      .doc-body a:hover { border-color: var(--brand); }

      .highlight-box {
        background: var(--brand-soft);
        border: 1px solid rgba(124,111,255,0.2);
        border-radius: 14px;
        padding: 20px 22px;
        margin: 24px 0;
      }

      .highlight-box p { color: var(--ink); margin: 0; font-size: 0.95rem; }

      /* FOOTER */
      footer {
        margin-top: 64px;
        padding-top: 32px;
        border-top: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      footer p { color: var(--muted); font-size: 0.84rem; margin: 0; }

      .footer-links {
        display: flex;
        gap: 20px;
      }

      .footer-links a {
        color: var(--muted);
        text-decoration: none;
        font-size: 0.84rem;
        transition: color 0.2s;
      }

      .footer-links a:hover { color: var(--ink); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <nav>
        <a class="logo" href="${WEBSITE}">
          <span class="logo-mark"></span>
          <span>${COMPANY}</span>
        </a>
        <a class="nav-link" href="${WEBSITE}/app">Go to App →</a>
      </nav>

      ${body}

      <footer>
        <p>© ${new Date().getFullYear()} ${COMPANY}. All rights reserved.</p>
        <div class="footer-links">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/data-deletion">Data Deletion</a>
        </div>
      </footer>
    </div>
  </body>
</html>`;
}

export function getPrivacyPolicyHtml() {
  const name = config.botName || COMPANY;
  return renderPage({
    title: "Privacy Policy",
    description: `How ${name} collects, uses, and protects your information.`,
    body: `
      <header class="doc-header">
        <div class="doc-label">Legal Document</div>
        <h1 class="doc-title">Privacy Policy</h1>
        <div class="doc-meta">
          <span>📅 Effective: ${EFFECTIVE_DATE}</span>
          <span>🏢 ${name}</span>
          <span>📧 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></span>
        </div>
      </header>

      <div class="doc-body">
        <div class="highlight-box">
          <p>We are committed to protecting your privacy. This policy explains what data we collect, why we collect it, and how you can control it. We never sell your personal data.</p>
        </div>

        <h2>1. Who We Are</h2>
        <p>${name} is an AI-powered WhatsApp assistant platform operated by ${COMPANY}. Our service allows businesses to automate conversations and manage customer interactions via WhatsApp.</p>

        <h2>2. Information We Collect</h2>
        <ul>
          <li>WhatsApp phone numbers used to interact with our service</li>
          <li>Message content sent to and from the AI assistant</li>
          <li>Profile names shared by WhatsApp when available</li>
          <li>Account information (name, email, password hash) for dashboard users</li>
          <li>Business configuration data entered in the dashboard</li>
          <li>Usage metadata such as timestamps and session information</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To process and respond to WhatsApp messages via the AI assistant</li>
          <li>To provide reminders, contact management, and conversation history features</li>
          <li>To authenticate dashboard users and maintain secure sessions</li>
          <li>To improve service reliability, quality, and security</li>
          <li>To send transactional emails (welcome, password reset, team invites)</li>
          <li>To maintain operational logs for troubleshooting and abuse prevention</li>
        </ul>

        <h2>4. Data Storage and Security</h2>
        <p>Your data is stored on secure cloud infrastructure (Railway). We implement industry-standard security measures including encrypted connections (HTTPS/TLS), hashed passwords, and token-based authentication. We do not store WhatsApp message content beyond what is necessary for service operation.</p>

        <h2>5. Data Sharing</h2>
        <p>We do not sell your personal data. We may share data with trusted service providers required to operate our platform:</p>
        <ul>
          <li>Meta (WhatsApp Business API) — message delivery</li>
          <li>AiSensy — WhatsApp messaging infrastructure</li>
          <li>Railway — cloud hosting and infrastructure</li>
          <li>Resend — transactional email delivery</li>
          <li>Stripe — payment processing (if applicable)</li>
        </ul>

        <h2>6. Cookies and Tracking</h2>
        <p>Our dashboard uses a single session cookie to keep you logged in. We do not use advertising cookies or third-party tracking pixels. No personal data is used for targeted advertising.</p>

        <h2>7. Data Retention</h2>
        <p>Conversation history is retained to enable features like history search and context-aware responses. Account data is retained for as long as your account is active. You may request deletion at any time (see Section 9).</p>

        <h2>8. Your Rights</h2>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data (subject to legal retention obligations)</li>
          <li>Withdraw consent and stop using the service at any time</li>
          <li>Lodge a complaint with your local data protection authority</li>
        </ul>

        <h2>9. Data Deletion</h2>
        <p>To request deletion of your data, visit <a href="/data-deletion">/data-deletion</a> or email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> with your phone number or account email. Requests are processed within 30 days.</p>

        <h2>10. Children's Privacy</h2>
        <p>Our service is not directed to children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us data, please contact us immediately.</p>

        <h2>11. Changes to This Policy</h2>
        <p>We may update this policy from time to time. We will notify registered users of significant changes by email. Continued use of the service after changes constitutes acceptance of the updated policy.</p>

        <h2>12. Contact Us</h2>
        <p>For privacy questions or data requests, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> or visit <a href="${WEBSITE}">${WEBSITE}</a>.</p>
      </div>
    `
  });
}

export function getTermsHtml() {
  const name = config.botName || COMPANY;
  return renderPage({
    title: "Terms of Service",
    description: `Terms and conditions for using ${name}.`,
    body: `
      <header class="doc-header">
        <div class="doc-label">Legal Document</div>
        <h1 class="doc-title">Terms of Service</h1>
        <div class="doc-meta">
          <span>📅 Effective: ${EFFECTIVE_DATE}</span>
          <span>🏢 ${name}</span>
          <span>📧 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></span>
        </div>
      </header>

      <div class="doc-body">
        <div class="highlight-box">
          <p>By accessing or using ${name}, you agree to be bound by these Terms of Service. Please read them carefully before using our platform.</p>
        </div>

        <h2>1. Acceptance of Terms</h2>
        <p>By creating an account or using ${name} in any way, you confirm that you are at least 18 years old, have read and understood these terms, and agree to be legally bound by them. If you are using the service on behalf of a business, you represent that you have authority to bind that business to these terms.</p>

        <h2>2. Description of Service</h2>
        <p>${name} provides an AI-powered WhatsApp assistant platform that enables businesses to automate customer conversations, manage leads, and configure automated responses. The service is provided on a subscription basis as described on our pricing page.</p>

        <h2>3. Permitted Use</h2>
        <ul>
          <li>Use the service only for lawful business and personal purposes</li>
          <li>Comply with WhatsApp's Terms of Service and Business Policy</li>
          <li>Maintain the security of your account credentials</li>
          <li>Promptly notify us of any unauthorized access to your account</li>
        </ul>

        <h2>4. Prohibited Use</h2>
        <ul>
          <li>Sending spam, unsolicited messages, or bulk marketing without consent</li>
          <li>Using the service for illegal, abusive, or harmful activity</li>
          <li>Attempting to reverse engineer, copy, or resell the platform</li>
          <li>Uploading malicious code or attempting to disrupt the service</li>
          <li>Impersonating other individuals, businesses, or entities</li>
          <li>Violating any applicable laws or regulations</li>
        </ul>

        <h2>5. Account Responsibilities</h2>
        <p>You are responsible for all activity that occurs under your account. Keep your password secure and do not share account credentials. We are not liable for losses caused by unauthorized access resulting from your failure to secure your credentials.</p>

        <h2>6. Subscription and Billing</h2>
        <p>Paid plans are billed on a recurring basis. Subscription fees are charged in advance. You may cancel at any time; cancellation takes effect at the end of the current billing period. We reserve the right to change pricing with 30 days notice to registered users. All fees are non-refundable except where required by law.</p>

        <h2>7. Service Availability</h2>
        <p>We aim for high availability but do not guarantee uninterrupted service. The service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We are not liable for losses caused by service interruptions.</p>

        <h2>8. Intellectual Property</h2>
        <p>All intellectual property rights in the ${name} platform, including software, designs, and documentation, belong to ${COMPANY}. You retain ownership of content you submit through the service. By using the service, you grant us a limited license to process your content solely to provide the service.</p>

        <h2>9. AI-Generated Content</h2>
        <p>The service uses AI models to generate responses. AI responses may contain errors or inaccuracies. You acknowledge that AI-generated content is not a substitute for professional legal, medical, financial, or emergency advice. We are not liable for decisions made based on AI-generated content.</p>

        <h2>10. Limitation of Liability</h2>
        <p>To the maximum extent permitted by applicable law, ${COMPANY} shall not be liable for any indirect, incidental, special, consequential, or punitive damages. Our total liability for any claim arising out of these terms shall not exceed the amount you paid us in the 12 months preceding the claim.</p>

        <h2>11. Indemnification</h2>
        <p>You agree to indemnify and hold harmless ${COMPANY} from any claims, damages, or expenses arising from your use of the service, your violation of these terms, or your violation of any third-party rights.</p>

        <h2>12. Termination</h2>
        <p>We may suspend or terminate your account if you violate these terms. You may close your account at any time. Upon termination, your right to use the service ceases immediately. Data deletion follows our Privacy Policy.</p>

        <h2>13. Governing Law</h2>
        <p>These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of India.</p>

        <h2>14. Changes to Terms</h2>
        <p>We may update these terms from time to time. We will notify you of material changes by email or in-app notice. Continued use after changes constitutes acceptance.</p>

        <h2>15. Contact</h2>
        <p>For questions about these terms, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
      </div>
    `
  });
}

export function getDataDeletionHtml() {
  const name = config.botName || COMPANY;
  return renderPage({
    title: "Data Deletion",
    description: `How to request deletion of your ${name} data.`,
    body: `
      <header class="doc-header">
        <div class="doc-label">Legal Document</div>
        <h1 class="doc-title">Data Deletion</h1>
        <div class="doc-meta">
          <span>📅 Updated: ${EFFECTIVE_DATE}</span>
          <span>🏢 ${name}</span>
          <span>📧 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></span>
        </div>
      </header>

      <div class="doc-body">
        <div class="highlight-box">
          <p>You have the right to request deletion of your personal data at any time. We process all deletion requests within 30 days and will confirm once complete.</p>
        </div>

        <h2>How to Request Deletion</h2>
        <p>Send your request to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> from the email address or WhatsApp number associated with your account.</p>

        <h2>Include in Your Request</h2>
        <ul>
          <li>Your full name and account email address (for dashboard accounts)</li>
          <li>Your WhatsApp phone number (for WhatsApp chat history)</li>
          <li>A clear statement that you want your data deleted</li>
        </ul>

        <h2>What Will Be Deleted</h2>
        <ul>
          <li>Your account profile (name, email, password hash)</li>
          <li>All conversation and chat history associated with your number or account</li>
          <li>Saved contact records tied to your account</li>
          <li>Reminder and scheduling data</li>
          <li>Business configuration data linked to your account</li>
          <li>Session tokens and authentication records</li>
        </ul>

        <h2>What May Be Retained</h2>
        <ul>
          <li>Anonymized usage statistics that cannot be linked back to you</li>
          <li>Records required for legal compliance, fraud prevention, or dispute resolution</li>
          <li>Billing records required by financial regulations (typically 7 years)</li>
        </ul>

        <h2>Processing Time</h2>
        <p>We will acknowledge your request within 5 business days and complete the deletion within 30 days. We will send a confirmation email once your data has been removed.</p>

        <h2>Questions</h2>
        <p>If you have questions about data deletion, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
      </div>
    `
  });
}
