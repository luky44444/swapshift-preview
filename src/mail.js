import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function logPath() {
  const dbPath = process.env.SWAPSHIFT_DB ?? ".data/swapshift.db";
  return dbPath.endsWith(".db") ? dbPath.replace(/[^/\\]+$/, "mail.log") : ".data/mail.log";
}

async function sendResend({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? "SWAPSHIFT <noreply@swapshift.local>";
  if (!key || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  return res.ok;
}

export async function notify({ to, subject, text }) {
  if (!to) return;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    to,
    subject,
    text,
  });
  try {
    const file = logPath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${line}\n`);
  } catch {
    console.log(`[mail] ${line}`);
  }
  try {
    await sendResend({ to, subject, text });
  } catch (error) {
    console.error("mail send failed", error);
  }
}
