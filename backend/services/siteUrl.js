const DEFAULT_DEV_ORIGIN = "http://localhost:5173";

function normalizeSiteUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Trusted public origin of this deployment. Only values supplied by the
 * operator or the hosting platform are accepted — never the request Host
 * header, which an attacker can spoof.
 */
export function getPublicSiteUrl() {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_SITE_URL,
    // Render sets this automatically for web services.
    process.env.RENDER_EXTERNAL_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSiteUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

/**
 * Base URL for emailed verification links. Production deployments must
 * configure FRONTEND_URL (or run on a platform that provides
 * RENDER_EXTERNAL_URL) so a spoofed Host header cannot redirect a victim's
 * verification token to an attacker-controlled origin.
 */
export function getVerificationBaseUrl() {
  const configured = getPublicSiteUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  return DEFAULT_DEV_ORIGIN;
}
