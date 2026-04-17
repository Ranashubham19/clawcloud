import { config } from "./config.js";

const FROM_NAME = config.botName || "Claw Cloud";
const DEFAULT_FROM = `${FROM_NAME} <onboarding@resend.dev>`;

async function sendViaResend({ to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.resendFrom || DEFAULT_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html: html || text
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend API error ${response.status}: ${details.slice(0, 200)}`);
  }

  return true;
}

async function sendViaSmtp({ to, subject, text, html }) {
  let nodemailer;
  try { nodemailer = await import("nodemailer"); } catch { return false; }
  if (!nodemailer?.createTransport) return false;

  const { smtpHost, smtpUser, smtpPass } = config;
  if (!smtpHost || !smtpUser || !smtpPass) return false;

  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: smtpUser, pass: smtpPass }
  });

  const from = config.smtpFrom || DEFAULT_FROM;
  await transport.sendMail({ from, to, subject, text, html: html || text });
  return true;
}

async function sendMail({ to, subject, text, html }) {
  if (config.resendApiKey) {
    try {
      return await sendViaResend({ to, subject, text, html });
    } catch (err) {
      console.error("[mailer] Resend failed:", err.message);
    }
  }

  if (config.smtpHost) {
    try {
      return await sendViaSmtp({ to, subject, text, html });
    } catch (err) {
      console.error("[mailer] SMTP failed:", err.message);
    }
  }

  console.log(`[mailer] No email provider configured. Would send to ${to}: ${subject}`);
  return false;
}

export async function sendWelcomeEmail({ name, email }) {
  const appUrl = config.appBaseUrl || "";
  return sendMail({
    to: email,
    subject: `Welcome to ${FROM_NAME}!`,
    text: `Hi ${name},\n\nWelcome! Your account is ready.\n\nLog in at ${appUrl}/app\n\nThanks,\nThe ${FROM_NAME} Team`,
    html: `<h2>Welcome, ${name}! 🎉</h2><p>Your account is ready.</p><p><a href="${appUrl}/app" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Go to Dashboard</a></p><p>Thanks,<br>The ${FROM_NAME} Team</p>`
  });
}

export async function sendPasswordResetEmail({ email, resetToken, appBaseUrl }) {
  const base = appBaseUrl || config.appBaseUrl || "";
  const link = `${base}/app?mode=reset&token=${resetToken}`;
  return sendMail({
    to: email,
    subject: "Reset your password",
    text: `Click this link to reset your password (expires in 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
    html: `<h2>Reset your password</h2><p>Click below to reset your password (expires in 1 hour):</p><p><a href="${link}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Reset Password</a></p><p>If you did not request this, ignore this email.</p>`
  });
}

export async function sendTeamInviteEmail({ inviterName, email, businessName, inviteToken, appBaseUrl }) {
  const base = appBaseUrl || config.appBaseUrl || "";
  const link = `${base}/app?invite=${inviteToken}`;
  return sendMail({
    to: email,
    subject: `You've been invited to join ${businessName}`,
    text: `${inviterName} invited you to join "${businessName}" on ${FROM_NAME}.\n\nAccept invite: ${link}`,
    html: `<h2>You've been invited! 🎉</h2><p><strong>${inviterName}</strong> invited you to join <strong>${businessName}</strong> on ${FROM_NAME}.</p><p><a href="${link}" style="background:#000;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Accept Invite</a></p>`
  });
}

export async function sendNewLeadAlert({ business, lead }) {
  if (!business?.supportEmail) return false;
  return sendMail({
    to: business.supportEmail,
    subject: `New lead: ${lead.name || lead.phone}`,
    text: `New lead captured for ${business.name}.\n\nName: ${lead.name || "-"}\nPhone: ${lead.phone}\nCourse: ${lead.courseInterest || "-"}\nStatus: ${lead.status}\n\nView in dashboard: ${config.appBaseUrl || ""}/app`,
    html: `<h2>New lead: ${lead.name || lead.phone}</h2><table><tr><td>Name</td><td>${lead.name || "-"}</td></tr><tr><td>Phone</td><td>${lead.phone}</td></tr><tr><td>Status</td><td>${lead.status}</td></tr></table><p><a href="${config.appBaseUrl || ""}/app">View in dashboard</a></p>`
  });
}
