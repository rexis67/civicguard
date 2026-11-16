import { createReport } from "./api.js";

const DB_NAME = "civicguard_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "pending_reports";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return reject(new Error("IndexedDB is not supported on this platform."));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveOfflineReport(reportData) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const item = {
      ...reportData,
      id: reportData.id || `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    const request = store.put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

export async function getOfflineReports() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineReport(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function syncOfflineQueue(onReportSynced) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { syncedCount: 0, pendingCount: (await getOfflineReports()).length };
  }

  const reports = await getOfflineReports();
  if (reports.length === 0) return { syncedCount: 0, pendingCount: 0 };

  let syncedCount = 0;
  for (const item of reports) {
    try {
      const formData = new FormData();
      formData.set("title", item.title || "Offline report");
      formData.set("category", item.category);
      if (item.customCategory) formData.set("customCategory", item.customCategory);
      if (item.district) formData.set("district", item.district);
      formData.set("description", item.description);
      if (item.latitude && item.longitude) {
        formData.set("latitude", item.latitude);
        formData.set("longitude", item.longitude);
      }
      if (item.imageBlob) {
        formData.set("image", item.imageBlob, item.imageName || "photo.jpg");
      }

      const result = await createReport(formData);
      await deleteOfflineReport(item.id);
      syncedCount += 1;
      onReportSynced?.(result, item.id);
    } catch (syncError) {
      console.warn(`[offlineQueue] Could not sync offline report ${item.id}:`, syncError);
      break; // Pause until connectivity stabilizes
    }
  }

  const remaining = await getOfflineReports();
  return { syncedCount, pendingCount: remaining.length };
}
