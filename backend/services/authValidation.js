import { timingSafeEqual } from "node:crypto";

/**
 * Pure authentication helpers shared by the auth routes and unit tests.
 * Keeping them free of Express, database and environment side effects makes
 * them directly testable; callers pass configuration explicitly.
 */

export function normalizeRole(role) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalized === "citizen") return "citizen";
  if (normalized === "authority" || normalized === "authority member") {
    return "authority";
  }
  return null;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeEquals(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hasValidInviteCode(
  inviteCode,
  expectedCode = process.env.AUTHORITY_INVITE_CODE,
) {
  if (!expectedCode || typeof inviteCode !== "string") return false;
  return safeEquals(inviteCode, expectedCode);
}

export function isAllowlistedAuthorityEmail(email, allowedDomains = []) {
  const domain = String(email).split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return false;

  return allowedDomains.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

export function parseAuthorityEmailDomains(value = "") {
  return value
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}
