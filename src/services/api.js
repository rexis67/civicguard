// Empty base means "same origin", which is how the app is served in production
// (Express hosts the built frontend). Set VITE_API_URL only for a split deploy.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const API_URL = `${API_BASE}/api`;
const REPORTS_URL = `${API_URL}/reports`;
import { getDeviceHash } from "./deviceIdentity.js";

function requestError(message, response) {
  const error = new Error(message);
  if (response) error.status = response.status;
  return error;
}

function failureMessage(response, fallback) {
  if ([502, 503, 504].includes(response.status)) {
    return `The CivicGuard API is unreachable (HTTP ${response.status}). Check that the backend is running, then try again.`;
  }
  return fallback ?? `The request failed with status ${response.status}.`;
}

async function postAuthRequest(path, credentials) {
  const response = await fetch(`${API_URL}/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response, `Authentication failed (${response.status}).`), response);
  }

  return result;
}

export async function loginUser(credentials) {
  const result = await postAuthRequest("login", credentials);
  return result.user;
}

export async function registerUser(details) {
  return postAuthRequest("register", details);
}

export async function verifyEmailToken(token) {
  const result = await postAuthRequest("verify-email", { token });
  return result.user;
}

export async function resendVerificationEmail({ email, password }) {
  return postAuthRequest("resend-verification", { email, password });
}

export async function getAuthSession() {
  const response = await fetch(`${API_URL}/auth/session`, { credentials: "include" });
  if (response.status === 401) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response), response);
  }
  return result.user;
}

export async function logoutUser() {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw requestError(result.error ?? failureMessage(response), response);
  }
}

export async function requestPasswordReset(email) {
  return postAuthRequest("forgot-password", { email });
}

export async function resetPassword(token, password) {
  return postAuthRequest("reset-password", { token, password });
}

export async function getReportsPage({
  limit = 100,
  offset = 0,
  assignedTo,
  admin = false,
  overdue = false,
} = {}) {
  try {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (assignedTo) query.set("assignedTo", assignedTo);
    if (overdue) query.set("overdue", "true");
    const url = admin ? `${API_URL}/admin/reports?${query}` : `${REPORTS_URL}?${query}`;
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw requestError(
        details?.error ?? failureMessage(response),
        response,
      );
    }

    const page = await response.json();
    // Older CivicGuard deployments returned a bare report array. Keep the
    // split Vercel frontend usable until its Render backend is redeployed.
    if (Array.isArray(page)) {
      return {
        total: page.length,
        limit,
        offset,
        data: page,
      };
    }
    return {
      total: Number.isSafeInteger(page.total) ? page.total : 0,
      limit: Number.isSafeInteger(page.limit) ? page.limit : limit,
      offset: Number.isSafeInteger(page.offset) ? page.offset : offset,
      data: Array.isArray(page.data) ? page.data : [],
    };
  } catch (error) {
    if (error.status) throw error;
    const message = error instanceof Error ? error.message : "Unknown network error.";
    console.error("[CivicGuard API] Failed to fetch reports:", error);
    throw new Error(`Unable to get reports: ${message}`, { cause: error });
  }
}

export async function getReports(options = {}) {
  const page = await getReportsPage(options);
  return page.data;
}

export async function getImpactMetrics() {
  return authenticatedJsonRequest("/admin/metrics");
}

export async function getCityHealthMetrics() {
  const response = await fetch(`${API_URL}/city-health`, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response), response);
  }
  return result;
}

export async function getMapTileConfig() {
  const response = await fetch(`${API_URL}/public-config`, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response), response);
  }
  if (
    !result ||
    (result.mapProvider !== "carto" && result.mapProvider !== "maptiler") ||
    (result.mapProvider === "maptiler" &&
      (typeof result.mapTilerKey !== "string" || !result.mapTilerKey.trim()))
  ) {
    throw new Error("The map provider configuration returned by CivicGuard is invalid.");
  }
  return result;
}

export async function getTrackedReport(code) {
  const response = await fetch(`${API_URL}/track/${encodeURIComponent(code)}`, {
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response), response);
  }
  return result;
}

export async function confirmReport(id) {
  const deviceHash = await getDeviceHash();
  const response = await fetch(`${REPORTS_URL}/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceHash }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 409 && result.alreadyConfirmed) return result;
  if (!response.ok) {
    throw requestError(result.error ?? failureMessage(response), response);
  }
  return result;
}

async function authenticatedJsonRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(
      result.error ?? failureMessage(response),
      response,
    );
  }
  return result;
}

export async function getUsers() {
  return authenticatedJsonRequest("/users");
}

export async function updateUserRole(id, role) {
  return authenticatedJsonRequest(`/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(id) {
  return authenticatedJsonRequest(`/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function assignReport(id, assignedTo) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(id)}/assignment`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedTo }),
  });
}

export async function getReportAudits(id) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(id)}/audits`);
}

export async function getReportFieldAudits(id) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(id)}/field-audits`);
}

export async function updateReportTriage(id, patch) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(id)}/triage-review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function splitDuplicateReport(id) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(id)}/split`, {
    method: "POST",
  });
}

export async function mergeReports(sourceId, targetId) {
  return authenticatedJsonRequest(`${REPORTS_URL}/${encodeURIComponent(sourceId)}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId }),
  });
}

export async function createReport(formData) {
  try {
    const response = await fetch(REPORTS_URL, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw requestError(
        details?.error ?? failureMessage(response),
        response,
      );
    }

    return await response.json();
  } catch (error) {
    if (error.status) throw error;
    const message = error instanceof Error ? error.message : "Unknown network error.";
    console.error("[CivicGuard API] Failed to create report:", error);
    throw new Error(`Unable to create report: ${message}`, { cause: error });
  }
}

export async function retryReportTriage(id) {
  const response = await fetch(`${REPORTS_URL}/${encodeURIComponent(id)}/triage`, {
    method: "POST",
    credentials: "include",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw requestError(
      result.error ?? failureMessage(response, `Could not retry triage (${response.status}).`),
      response,
    );
  }
  return result;
}

export async function updateReportStatus(id, status, token, note = null, afterPhoto = null) {
  try {
    const formData = new FormData();
    formData.set("status", status);
    if (note) formData.set("note", note);
    if (afterPhoto?.size > 0) formData.set("afterPhoto", afterPhoto, afterPhoto.name);
    const response = await fetch(`${REPORTS_URL}/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        ...(afterPhoto?.size > 0 ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: afterPhoto?.size > 0 ? formData : JSON.stringify({ status, note }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw requestError(
        details?.error ?? failureMessage(response),
        response,
      );
    }

    return await response.json();
  } catch (error) {
    if (error.status) throw error;
    const message = error instanceof Error ? error.message : "Unknown network error.";
    console.error("[CivicGuard API] Failed to update report status:", error);
    throw new Error(`Unable to update report status: ${message}`, { cause: error });
  }
}

export async function deleteReport(id, token) {
  try {
    const response = await fetch(`${REPORTS_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw requestError(
        details?.error ?? failureMessage(response),
        response,
      );
    }

    return await response.json();
  } catch (error) {
    if (error.status) throw error;
    const message = error instanceof Error ? error.message : "Unknown network error.";
    console.error("[CivicGuard API] Failed to delete report:", error);
    throw new Error(`Unable to delete report: ${message}`, { cause: error });
  }
}
