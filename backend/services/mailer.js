import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  const suppliedSettings = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD].filter(Boolean).length;

  if (suppliedSettings === 0) return null;
  if (suppliedSettings !== 4) {
    throw new Error("Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD together.");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
  }

  return transporter;
}

export async function sendVerificationEmail({ email, name, verificationUrl }) {
  const mailer = getTransporter();
  if (!mailer) {
    // No SMTP is configured. Callers decide whether to expose the link or fail
    // with a clear configuration error instead of pretending an email was sent.
    return { delivered: false, configured: false };
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Verify your CivicGuard email",
    text: `Hello ${name},\n\nVerify your email address to activate your CivicGuard account:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Verify your email address to activate your CivicGuard account:</p><p><a href="${escapeHtml(verificationUrl)}">Verify email</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this email.</p>`,
  });

  return { delivered: true };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
