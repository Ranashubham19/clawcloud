let nodemailer;
try { nodemailer = await import("nodemailer"); } catch { nodemailer = null; }
import { config } from "./config.js";

function getTransport() {
  if (!nodemailer?.createTransport) return null;
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass }
  });
}

const FROM = process.env.SMTP_FROM || `"${process.env.BOT_NAME || "Claw Cloud"}" <no-reply@example.com>`;

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[mailer] SMTP not configured. Would send to ${to}: ${subject}`);
    return false;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, text, html: html || text });
    return true;
  } catch (err) {
    console.error("[mailer] Send failed:", err.message);
    return false;
  }
}

export async function sendWelcomeEmail({ name, email }) {
  return sendMail({
    to: email,
    subject: `Welcome to ${config.botName || "Claw Cloud"}!`,
    text: `Hi ${name},\n\nWelcome! Your account is ready. Log in at ${config.appBaseUrl || ""}/app\n\nThanks,\nThe ${config.botName || "Claw Cloud"} Team`,
    html: `<h2>Welcome, ${name}!</h2><p>Your account is ready. <a href="${config.appBaseUrl || ""}/app">Log in to your dashboard</a>.</p>`
  });
}

export async function sendPasswordResetEmail({ email, resetToken, appBaseUrl }) {
  const base = appBaseUrl || config.appBaseUrl || "";
  const link = `${base}/app?mode=reset&token=${resetToken}`;
  return sendMail({
    to: email,
    subject: "Reset your password",
    text: `Click this link to reset your password (expires in 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click below to reset your password (expires in 1 hour):</p><p><a href="${link}">Reset Password</a></p><p>If you did not request this, ignore this email.</p>`
  });
}

export async function sendTeamInviteEmail({ inviterName, email, businessName, inviteToken, appBaseUrl }) {
  const base = appBaseUrl || config.appBaseUrl || "";
  const link = `${base}/app?invite=${inviteToken}`;
  return sendMail({
    to: email,
    subject: `You've been invited to join ${businessName}`,
    text: `${inviterName} invited you to join "${businessName}" on ${config.botName || "Claw Cloud"}.\n\nAccept invite: ${link}`,
    html: `<p><strong>${inviterName}</strong> invited you to join <strong>${businessName}</strong>.</p><p><a href="${link}">Accept Invite</a></p>`
  });
}

export async function sendNewLeadAlert({ business, lead }) {
  if (!business?.supportEmail) return false;
  return sendMail({
    to: business.supportEmail,
    subject: `New lead: ${lead.name || lead.phone}`,
    text: `New lead captured for ${business.name}.\n\nName: ${lead.name || "-"}\nPhone: ${lead.phone}\nCourse: ${lead.courseInterest || "-"}\nStatus: ${lead.status}\n\nView in dashboard: ${config.appBaseUrl || ""}/app`
  });
}
