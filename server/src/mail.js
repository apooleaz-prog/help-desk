import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const MAIL_FROM = String(process.env.MAIL_FROM || "").trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const MAIL_REGION =
  process.env.MAIL_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-west-1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function sendViaSmtp({ to, subject, text, html }) {
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: MAIL_FROM || SMTP_USER || "Help Desk <noreply@localhost>",
    to,
    subject,
    text,
    html,
  });
}

async function sendViaSes({ to, subject, text, html }) {
  const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const client = new SESv2Client({ region: MAIL_REGION });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: MAIL_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: text, Charset: "UTF-8" },
            Html: { Data: html, Charset: "UTF-8" },
          },
        },
      },
    })
  );
}

async function sendMail(message) {
  if (SMTP_HOST) {
    await sendViaSmtp(message);
    return "smtp";
  }
  if (MAIL_FROM) {
    await sendViaSes(message);
    return "ses";
  }
  console.log("[mail] no SMTP_HOST or MAIL_FROM configured; logging message instead");
  console.log(`[mail] to=${message.to}`);
  console.log(`[mail] subject=${message.subject}`);
  console.log(message.text);
  return "log";
}

function passwordResetEmail({ name, resetUrl }) {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const text = [
    greeting,
    "",
    "Use this link to choose a new Help Desk password. It expires in 1 hour.",
    "",
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
    "",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    "<p>Use this link to choose a new Help Desk password. It expires in 1 hour.</p>",
    `<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>`,
    "<p>If you did not request this, you can ignore this email.</p>",
  ].join("");
  return {
    subject: "Reset your Help Desk password",
    text,
    html,
  };
}

function alertKindLabel(kind) {
  if (kind === "callback") return "Call back";
  if (kind === "urgent") return "Urgent";
  return "Alert";
}

function formatAlertWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function alertDigestEmail({ alerts, appUrl }) {
  const count = alerts.length;
  const subject =
    count === 1
      ? `Help Desk alert: ${alerts[0].message || alertKindLabel(alerts[0].kind)}`
      : `Help Desk: ${count} open alerts`;
  const lines = alerts.map((alert) => {
    const kind = alertKindLabel(alert.kind);
    const when = formatAlertWhen(alert.createdAt);
    const ticket = alert.ticketTitle || alert.ticketId || "a ticket";
    return [
      `${kind}: ${alert.message || "New alert"}`,
      `From ticket: ${ticket}`,
      when ? `Opened: ${when}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const text = [
    count === 1
      ? "There is an open Help Desk alert:"
      : `There are ${count} open Help Desk alerts:`,
    "",
    ...lines.flatMap((block, i) => (i ? ["", block] : [block])),
    "",
    `Open Help Desk: ${appUrl}`,
    "These emails stop when all alerts are cleared.",
    "",
  ].join("\n");
  const htmlItems = alerts
    .map((alert) => {
      const kind = escapeHtml(alertKindLabel(alert.kind));
      const message = escapeHtml(alert.message || "New alert");
      const ticket = escapeHtml(alert.ticketTitle || alert.ticketId || "a ticket");
      const when = formatAlertWhen(alert.createdAt);
      return [
        "<li>",
        `<p><strong>${kind}</strong> — ${message}</p>`,
        `<p>From ticket: ${ticket}</p>`,
        when ? `<p>Opened: ${escapeHtml(when)}</p>` : "",
        "</li>",
      ].join("");
    })
    .join("");
  const html = [
    `<p>${
      count === 1
        ? "There is an open Help Desk alert:"
        : `There are ${count} open Help Desk alerts:`
    }</p>`,
    `<ul>${htmlItems}</ul>`,
    `<p><a href="${escapeHtml(appUrl)}">Open Help Desk</a></p>`,
    "<p>These emails stop when all alerts are cleared.</p>",
  ].join("");
  return { subject, text, html };
}

export { sendMail, passwordResetEmail, alertDigestEmail };
