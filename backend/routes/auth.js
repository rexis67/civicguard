import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import {
  deleteUnverifiedUser,
  getUserByEmail,
  saveUser,
  setEmailVerification,
  updateEmailVerification,
  verifyUserEmail,
} from "../services/db.js";
import { getJwtSecret } from "../services/jwtSecret.js";
import { sendVerificationEmail } from "../services/mailer.js";

// Load the backend-local environment file before reading module-level settings.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const router = express.Router();
const PASSWORD_MIN_LENGTH = 8;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

const configuredAuthLimit = Number.parseInt(process.env.AUTH_RATE_LIMIT ?? "60", 10);
const configuredLoginLimit = Number.parseInt(process.env.LOGIN_RATE_LIMIT ?? "10", 10);

const authLimiter = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  limit: Number.isInteger(configuredAuthLimit) && configuredAuthLimit > 0 ? configuredAuthLimit : 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
});

const loginLimiter = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  limit: Number.isInteger(configuredLoginLimit) && configuredLoginLimit > 0 ? configuredLoginLimit : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait and try again." },
});

router.use(authLimiter);

function normalizeRole(role) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalized === "citizen") return "citizen";
  if (normalized === "authority" || normalized === "authority member") {
    return "authority";
  }
  return null;
}

const authorityEmailDomains = (process.env.AUTHORITY_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

function safeEquals(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hasValidInviteCode(inviteCode) {
  const expected = process.env.AUTHORITY_INVITE_CODE;
  if (!expected || typeof inviteCode !== "string") return false;
  return safeEquals(inviteCode, expected);
}

function isAllowlistedAuthorityEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return false;

  return authorityEmailDomains.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

/**
 * The verification link is only echoed back to the caller when email delivery is
 * unavailable *and* the deployment explicitly allows it. Never in production
 * unless RETURN_VERIFICATION_LINK is set to "true" on purpose.
 */
function shouldReturnVerificationLink() {
  const setting = (process.env.RETURN_VERIFICATION_LINK ?? "").toLowerCase();
  if (setting === "false") return false;
  if (setting === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createAuthResponse(user, secret) {
  const token = jwt.sign(
    { email: user.email, role: user.role },
    secret,
    {
      subject: user.id,
      issuer: "civicguard",
      expiresIn: "8h",
    },
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

function hashVerificationToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function verificationLink(token) {
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${frontendUrl}/?verifyEmail=${encodeURIComponent(token)}`;
}

async function issueVerification(user, existingTokenHash = null) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = Date.now() + VERIFICATION_TTL_MS;

  if (existingTokenHash) {
    const updated = await updateEmailVerification(user.id, tokenHash, expiresAt);
    if (!updated) return null;
  } else {
    await setEmailVerification(user.id, tokenHash, expiresAt);
  }

  const url = verificationLink(rawToken);
  const delivery = await sendVerificationEmail({
    email: user.email,
    name: user.name,
    verificationUrl: url,
  });

  return {
    verificationRequired: true,
    message: "Check your email for a verification link. The link expires in 24 hours.",
    ...(delivery.delivered || !shouldReturnVerificationLink() ? {} : { verificationUrl: url }),
  };
}

router.post("/register", async (request, response, next) => {
  try {
    const { name, email, password, inviteCode } = request.body ?? {};
    const role = normalizeRole(request.body?.role);

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !isValidEmail(email.trim()) ||
      typeof password !== "string" ||
      password.length < PASSWORD_MIN_LENGTH ||
      Buffer.byteLength(password, "utf8") > 72 ||
      !role
    ) {
      response.status(400).json({
        error: "Provide a name, valid email, password (8–72 bytes), and a valid role.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (
      role === "authority" &&
      !hasValidInviteCode(inviteCode) &&
      !isAllowlistedAuthorityEmail(normalizedEmail)
    ) {
      response.status(403).json({
        error: "Authority registration requires a valid invite code.",
      });
      return;
    }

    const existingUser = await getUserByEmail(normalizedEmail);
    if (existingUser) {
      if (!existingUser.emailVerified) {
        const verification = await issueVerification(existingUser, "refresh");
        response.status(202).json(verification ?? {
          verificationRequired: true,
          message: "If the account is eligible, a verification link will be sent.",
        });
        return;
      }
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await saveUser({
      id: randomUUID(),
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role,
      emailVerified: false,
      createdAt: new Date().toISOString(),
    });

    try {
      response.status(201).json(await issueVerification(user));
    } catch (error) {
      await deleteUnverifiedUser(user.id);
      throw error;
    }
  } catch (error) {
    if (error.code === "DUPLICATE_EMAIL") {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    next(error);
  }
});

router.post("/verify-email", async (request, response, next) => {
  try {
    const token = request.body?.token;
    if (typeof token !== "string" || token.length < 32 || token.length > 256) {
      response.status(400).json({ error: "A valid email verification token is required." });
      return;
    }

    const user = await verifyUserEmail(hashVerificationToken(token));
    if (!user) {
      response.status(400).json({ error: "The verification link is invalid or expired." });
      return;
    }

    response.json(createAuthResponse(user, await getJwtSecret()));
  } catch (error) {
    next(error);
  }
});

router.post("/resend-verification", async (request, response, next) => {
  try {
    const email = request.body?.email;
    if (typeof email !== "string" || !isValidEmail(email.trim())) {
      response.status(400).json({ error: "A valid email address is required." });
      return;
    }

    const user = await getUserByEmail(email.trim().toLowerCase());
    if (!user || user.emailVerified) {
      response.json({ message: "If the account needs verification, a new link will be sent." });
      return;
    }

    const verification = await issueVerification(user, "refresh");
    response.json(verification ?? {
      message: "If the account needs verification, a new link will be sent.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", loginLimiter, async (request, response, next) => {
  try {
    const { email, password } = request.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      response.status(400).json({ error: "Email and password are required." });
      return;
    }

    const user = await getUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      response.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    if (!user.emailVerified) {
      response.status(403).json({ error: "Verify your email address before signing in." });
      return;
    }

    response.json(createAuthResponse(user, await getJwtSecret()));
  } catch (error) {
    next(error);
  }
});

export default router;
