export const AUTH_COOKIE_NAME = "civicguard_session";

const AUTH_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/api",
});

export function setAuthCookie(response, token) {
  response.cookie(AUTH_COOKIE_NAME, token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(response) {
  response.clearCookie(AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS);
}

export function getAuthCookie(request) {
  const cookieHeader = request.get("cookie") ?? "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== AUTH_COOKIE_NAME) continue;

    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
