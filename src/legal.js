import { config } from "./config.js";

const legalDate = "April 12, 2026";

function renderPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --card: #ffffff;
        --text: #172033;
        --muted: #57627a;
        --line: #d7deea;
        --accent: #0b6bcb;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
        color: var(--text);
      }
      main {
        max-width: 860px;
        margin: 40px auto;
        padding: 0 20px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 32px;
        box-shadow: 0 18px 50px rgba(18, 38, 63, 0.08);
      }
      h1, h2 {
        margin-top: 0;
      }
      h1 {
        font-size: 34px;
        margin-bottom: 10px;
      }
      h2 {
        font-size: 20px;
        margin-top: 28px;
      }
      p, li {
        line-height: 1.65;
        color: var(--text);
      }
      .muted {
        color: var(--muted);
      }
      a {
        color: var(--accent);
      }
      ul {
        padding-left: 20px;
      }
      .brand {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        ${body}
      </section>
    </main>
  </body>
</html>`;
}

export function getPrivacyPolicyHtml() {
  return renderPage({
    title: `${config.botName} Privacy Policy`,
    body: `
      <div class="brand">${config.botName}</div>
      <h1>Privacy Policy</h1>
      <p class="muted">Effective date: ${legalDate}</p>
      <p>
        This Privacy Policy explains how ${config.botName} collects, uses, and stores
        information when users interact with the service through WhatsApp.
      </p>

      <h2>Information We Collect</h2>
      <ul>
        <li>Phone numbers used to communicate with the service</li>
        <li>Message content sent to the service</li>
        <li>Basic profile information made available by WhatsApp, such as profile name</li>
        <li>Operational metadata needed to deliver messages, reminders, and prevent duplicates</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>To receive, process, and respond to user messages</li>
        <li>To provide reminders, message history, and other requested features</li>
        <li>To improve reliability, security, and service quality</li>
        <li>To maintain logs required for troubleshooting and abuse prevention</li>
      </ul>

      <h2>Storage and Security</h2>
      <p>
        Messages and related service data may be stored on cloud infrastructure used to run
        the application. Reasonable technical and operational measures are used to protect
        service data.
      </p>

      <h2>Sharing</h2>
      <p>
        Service data is not sold. Information may be processed by infrastructure and service
        providers required to operate the application, including WhatsApp and hosting vendors.
      </p>

      <h2>User Choices</h2>
      <p>
        Users can stop using the service at any time by discontinuing messages to the WhatsApp
        number. Users may also request deletion of stored service data by following the data
        deletion instructions linked below.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, contact:
        <a href="mailto:ranashubham8988@gmail.com">ranashubham8988@gmail.com</a>
      </p>

      <p class="muted">
        Data deletion instructions:
        <a href="/data-deletion">/data-deletion</a>
      </p>
    `
  });
}

export function getTermsHtml() {
  return renderPage({
    title: `${config.botName} Terms of Service`,
    body: `
      <div class="brand">${config.botName}</div>
      <h1>Terms of Service</h1>
      <p class="muted">Effective date: ${legalDate}</p>
      <p>
        By using ${config.botName}, you agree to use the service lawfully and responsibly.
      </p>

      <h2>Service Use</h2>
      <ul>
        <li>Do not use the service for illegal, abusive, or harmful activity</li>
        <li>Do not attempt to disrupt, reverse engineer, or misuse the service</li>
        <li>Do not rely on the service as a substitute for legal, medical, or emergency advice</li>
      </ul>

      <h2>Availability</h2>
      <p>
        The service may change, pause, or stop at any time without notice. Replies may be delayed,
        filtered, or unavailable depending on platform and infrastructure conditions.
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        The service is provided on an as-is basis without warranties of uninterrupted or error-free
        availability. To the extent permitted by law, liability is limited for indirect or
        consequential damages.
      </p>

      <h2>Contact</h2>
      <p>
        For service questions, contact:
        <a href="mailto:ranashubham8988@gmail.com">ranashubham8988@gmail.com</a>
      </p>
    `
  });
}

export function getDataDeletionHtml() {
  return renderPage({
    title: `${config.botName} Data Deletion`,
    body: `
      <div class="brand">${config.botName}</div>
      <h1>Data Deletion Instructions</h1>
      <p class="muted">Updated: ${legalDate}</p>
      <p>
        If you want your service data deleted, send a request from the same WhatsApp number used
        with the service or email the request to
        <a href="mailto:ranashubham8988@gmail.com">ranashubham8988@gmail.com</a>.
      </p>

      <h2>Please Include</h2>
      <ul>
        <li>Your WhatsApp phone number</li>
        <li>A short request stating that you want your stored data deleted</li>
      </ul>

      <h2>What Will Be Deleted</h2>
      <ul>
        <li>Stored conversation history associated with the requesting phone number</li>
        <li>Saved contact records related to the request where applicable</li>
        <li>Reminder records associated with the requesting phone number where applicable</li>
      </ul>

      <p>
        Some operational logs may be retained for security, compliance, and fraud-prevention purposes
        for a limited period where required.
      </p>
    `
  });
}
