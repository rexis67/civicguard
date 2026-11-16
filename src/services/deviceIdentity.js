const DEVICE_HASH_KEY = "civicguard-device-hash";
const CONFIRMED_REPORTS_KEY = "civicguard-confirmed-reports";

export async function getDeviceHash() {
  const cached = window.localStorage.getItem(DEVICE_HASH_KEY);
  if (cached && /^[a-f0-9]{64}$/i.test(cached)) return cached;

  const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
  const digest = await window.crypto.subtle.digest("SHA-256", randomBytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  window.localStorage.setItem(DEVICE_HASH_KEY, hash);
  return hash;
}

export function hasConfirmedReport(reportId) {
  const saved = window.localStorage.getItem(CONFIRMED_REPORTS_KEY);
  if (!saved) return false;
  try {
    const reportIds = JSON.parse(saved);
    return Array.isArray(reportIds) && reportIds.includes(String(reportId));
  } catch (error) {
    console.error("[CivicGuard] Could not read locally confirmed report IDs:", error);
    return false;
  }
}

export function markReportConfirmed(reportId) {
  const saved = window.localStorage.getItem(CONFIRMED_REPORTS_KEY);
  let reportIds = [];
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) reportIds = parsed.filter((id) => typeof id === "string");
    } catch (error) {
      console.error("[CivicGuard] Could not update locally confirmed report IDs:", error);
    }
  }
  const next = new Set(reportIds);
  next.add(String(reportId));
  window.localStorage.setItem(CONFIRMED_REPORTS_KEY, JSON.stringify([...next]));
}
