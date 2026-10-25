// Empty base means "same origin", which is how the app is served in production
// (Express hosts the built frontend). Set VITE_API_URL only for a split deploy.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const API_URL = `${API_BASE}/api`;
const REPORTS_URL = `${API_URL}/reports`;

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
  return postAuthRequest("login", credentials);
}

export async function registerUser(details) {
  return postAuthRequest("register", details);
}

export async function verifyEmailToken(token) {
  return postAuthRequest("verify-email", { token });
}

export async function resendVerificationEmail(email) {
  return postAuthRequest("resend-verification", { email });
}

export async function getReports() {
  try {
    const response = await fetch(REPORTS_URL);
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
    console.error("[CivicGuard API] Failed to fetch reports:", error);
    throw new Error(`Unable to get reports: ${message}`, { cause: error });
  }
}

export async function createReport(formData) {
  try {
    const response = await fetch(REPORTS_URL, {
      method: "POST",
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

export async function updateReportStatus(id, status, token) {
  try {
    const response = await fetch(`${REPORTS_URL}/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
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
      headers: { Authorization: `Bearer ${token}` },
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
