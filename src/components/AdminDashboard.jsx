import { Fragment, useEffect, useMemo, useState } from "react";
import {
  assignReport,
  deleteUser as deleteUserRequest,
  deleteReport as deleteReportRequest,
  getReportAudits,
  getReportFieldAudits,
  getImpactMetrics,
  getReportsPage,
  getUsers,
  mergeReports as mergeReportsRequest,
  splitDuplicateReport as splitDuplicateReportRequest,
  updateReportTriage,
  updateUserRole as saveUserRole,
  updateReportStatus as saveReportStatus,
} from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import cityConfig from "../../config/city.json";

const REFRESH_INTERVAL_MS = 5000;
const statuses = ["Pending", "In Progress", "Resolved"];
const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };

const urgencyStyles = {
  critical: "border-alert/30 bg-alert/10 text-alert",
  high: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  medium: "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-400/25 dark:bg-yellow-400/10 dark:text-yellow-300",
  low: "border-mint/25 bg-mint/10 text-mint",
};

const statusStyles = {
  Pending: "bg-pending/10 text-pending",
  "In Progress": "bg-progress/10 text-progress",
  Resolved: "bg-resolved/10 text-resolved",
};

function normalizeReport(report, index) {
  const analysis =
    report.analysis && typeof report.analysis === "object" ? report.analysis : {};
  const severityValue =
    report.severityScore ??
    report.severity_score ??
    analysis.severityScore ??
    analysis.severity_score ??
    analysis.severity;
  const severityNumber = Number(severityValue);
  const severityScore =
    Number.isFinite(severityNumber) && severityNumber >= 1 && severityNumber <= 5
      ? Math.round(severityNumber)
      : null;
  const urgencyLevel = String(
    report.urgencyLevel ??
      report.urgency ??
      analysis.urgencyLevel ??
      analysis.urgency ??
      "Low",
  );
  const category = String(report.category ?? analysis.category ?? "Uncategorized");

  return {
    id: String(report.id ?? `report-${index}`),
    title: String(
      report.title ?? analysis.title ?? analysis.issueTitle ?? `${category} report`,
    ),
    category,
    description: String(
      report.description ??
        analysis.summary ??
        analysis.description ??
        "No description provided.",
    ),
    urgencyLevel,
    severityScore,
    timestamp: report.timestamp ?? report.createdAt ?? report.created_at,
    status: statuses.includes(report.status) ? report.status : "Pending",
    assignedTo: typeof report.assignedTo === "string" ? report.assignedTo : "",
    reportCount: Number(report.reportCount) > 0 ? Number(report.reportCount) : 1,
    confirmationCount: Number(report.confirmationCount) > 0 ? Number(report.confirmationCount) : 0,
    duplicateOf: report.duplicateOf ?? null,
    department: report.department ?? "Municipal Services",
    slaDueAt: report.slaDueAt ?? null,
    remainingMs: Number.isFinite(report.remainingMs) ? report.remainingMs : null,
    overdue: Boolean(report.overdue),
    analysis: report.analysis ?? null,
    analysisStatus: report.analysisStatus ?? "pending",
    triageSuggestion: report.triageSuggestion ?? null,
    image: report.image ?? null,
    afterPhoto: report.afterPhoto ?? null,
    afterNote: report.afterNote ?? null,
  };
}

function formatTimeRemaining(remainingMs) {
  if (!Number.isFinite(remainingMs)) return "SLA not set";
  if (remainingMs <= 0) return "Overdue";
  const hours = Math.ceil(remainingMs / 3_600_000);
  if (hours < 24) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function addPrintField(documentRef, container, label, value) {
  const field = documentRef.createElement("section");
  field.className = "field";
  const heading = documentRef.createElement("h2");
  heading.textContent = label;
  const content = documentRef.createElement("p");
  content.textContent = value || "Not provided";
  field.append(heading, content);
  container.append(field);
}

function openPrintWorkOrder(report, status, onNotify) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    onNotify?.("Allow pop-ups to open the printable work order.");
    return;
  }
  printWindow.opener = null;

  const documentRef = printWindow.document;
  documentRef.title = `Work order — ${report.title}`;
  const style = documentRef.createElement("style");
  style.textContent = `
    @page { size: A4; margin: 16mm; }
    body { color: #0f1b2d; font: 14px/1.5 Arial, sans-serif; margin: 0; }
    main { max-width: 760px; margin: 0 auto; }
    header { border-bottom: 2px solid #1f3a5f; margin-bottom: 24px; padding-bottom: 16px; }
    h1 { font-size: 26px; margin: 0 0 6px; }
    h2 { color: #5b6b7f; font-size: 12px; margin: 0 0 6px; text-transform: uppercase; }
    p { margin: 0; white-space: pre-wrap; }
    .meta { color: #5b6b7f; }
    .fields { display: grid; gap: 16px 24px; grid-template-columns: 1fr 1fr; }
    .field { border-bottom: 1px solid #e3e8ef; padding: 10px 0; }
    .wide { grid-column: 1 / -1; }
    .photos { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-top: 20px; }
    figure { margin: 0; }
    img { border: 1px solid #e3e8ef; border-radius: 6px; max-height: 260px; object-fit: contain; width: 100%; }
    figcaption { color: #5b6b7f; font-size: 12px; margin-top: 5px; }
    @media print { body { print-color-adjust: exact; } }
  `;
  documentRef.head.replaceChildren(style);

  const main = documentRef.createElement("main");
  const header = documentRef.createElement("header");
  const title = documentRef.createElement("h1");
  title.textContent = report.title;
  const subtitle = documentRef.createElement("p");
  subtitle.className = "meta";
  subtitle.textContent = `CivicGuard work order · ${report.id.slice(0, 8).toUpperCase()}`;
  header.append(title, subtitle);
  main.append(header);

  const fields = documentRef.createElement("div");
  fields.className = "fields";
  addPrintField(documentRef, fields, "Category", report.category);
  addPrintField(documentRef, fields, "Severity", report.severityScore ? `${report.severityScore} / 5` : "Not rated");
  addPrintField(documentRef, fields, "Status", status);
  addPrintField(documentRef, fields, "Department", report.department);
  addPrintField(documentRef, fields, "Location", report.location
    ? `${report.location.lat}, ${report.location.lng}${report.district ? ` · ${report.district}` : ""}`
    : report.district);
  addPrintField(documentRef, fields, "Report notes", report.description);
  addPrintField(documentRef, fields, "AI summary", report.analysis?.summary || report.description);
  addPrintField(documentRef, fields, "Staff resolution note", report.afterNote);
  for (const index of [5, 6, 7]) fields.children[index]?.classList.add("wide");
  main.append(fields);

  const photos = documentRef.createElement("div");
  photos.className = "photos";
  const photoLoads = [];
  for (const [label, photo] of [
    ["Before", report.image],
    ["After", report.afterPhoto],
  ]) {
    if (!photo?.url) continue;
    const figure = documentRef.createElement("figure");
    const image = documentRef.createElement("img");
    image.alt = `${label} report photo`;
    photoLoads.push(new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      const photoUrl = new URL(photo.url, window.location.origin);
      if (photoUrl.protocol === "https:" || photoUrl.protocol === "http:") {
        image.src = photoUrl.toString();
      } else {
        resolve();
      }
      if (image.complete) resolve();
    }));
    const caption = documentRef.createElement("figcaption");
    caption.textContent = `${label} photo`;
    figure.append(image, caption);
    photos.append(figure);
  }
  if (photos.childElementCount) main.append(photos);
  documentRef.body.replaceChildren(main);
  Promise.race([
    Promise.all(photoLoads),
    new Promise((resolve) => window.setTimeout(resolve, 2000)),
  ]).then(() => {
    printWindow.focus();
    printWindow.print();
  });
}

function SummaryCard({ label, value, detail, accent, tint, icon }) {
  return (
    <article className="rounded-xl border border-line bg-panel p-5 shadow-sm transition hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
          <p className={`mt-2 font-display text-3xl font-bold tracking-tight ${accent}`}>{value}</p>
          <p className="mt-1 text-xs text-muted">{detail}</p>
        </div>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tint} ${accent}`}>
          <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
            <path d={icon} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Loading incident data" className="animate-pulse space-y-3 p-5" role="status">
      {[0, 1, 2, 3].map((row) => (
        <div className="flex items-center gap-5 rounded-lg border border-slate-100 dark:border-white/[0.04] bg-deep/50 p-4" key={row}>
          <span className="h-4 w-1/3 rounded bg-slate-200 dark:bg-white/10" />
          <span className="hidden h-4 w-20 rounded bg-slate-100 dark:bg-white/[0.06] sm:block" />
          <span className="hidden h-4 w-16 rounded bg-slate-100 dark:bg-white/[0.06] md:block" />
          <span className="ml-auto h-7 w-24 rounded bg-slate-200 dark:bg-white/10" />
        </div>
      ))}
      <span className="sr-only">Loading incident data…</span>
    </div>
  );
}

function SummarySkeletons() {
  return (
    <div aria-hidden="true" className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-3">
      {[0, 1, 2, 3, 4].map((card) => (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-panel p-5" key={card}>
          <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-white/[0.06]" />
          <div className="mt-4 h-9 w-1/3 rounded bg-slate-200 dark:bg-white/10" />
          <div className="mt-3 h-3 w-1/2 rounded bg-slate-100 dark:bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportReportsCsv(reports, statusById) {
  const columns = ["ID", "Category", "Severity", "Urgency", "Status", "Date", "People Reported", "Department", "SLA Due", "Overdue"];
  const rows = reports.map((report) => [
    report.id,
    report.category,
    report.severityScore ?? "",
    report.urgencyLevel,
    statusById[report.id] ?? report.status,
    formatTimestamp(report.timestamp),
    report.reportCount,
    report.department,
    formatTimestamp(report.slaDueAt),
    report.overdue ? "Yes" : "No",
  ]);
  const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");

  downloadLink.href = url;
  downloadLink.download = "civicguard_incidents.csv";
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminDashboard({ onNotify }) {
  const { user: currentUser, logout } = useAuth();
  const [reports, setReports] = useState([]);
  const [totalReports, setTotalReports] = useState(0);
  const [users, setUsers] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [impactMetrics, setImpactMetrics] = useState(null);
  const [mergeTargetById, setMergeTargetById] = useState({});
  const [triageBusyId, setTriageBusyId] = useState(null);
  const [statusById, setStatusById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [updatingReportId, setUpdatingReportId] = useState(null);
  const [deletingReportId, setDeletingReportId] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [managementError, setManagementError] = useState("");
  const [userActionId, setUserActionId] = useState(null);
  const [auditReportId, setAuditReportId] = useState(null);
  const [auditsByReport, setAuditsByReport] = useState({});
  const [fieldAuditsByReport, setFieldAuditsByReport] = useState({});
  const [auditLoadingId, setAuditLoadingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    let intervalId = 0;

    async function loadReports() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const page = await getReportsPage({
          assignedTo: assigneeFilter === "all" ? undefined : assigneeFilter,
          admin: true,
          overdue: overdueOnly,
        });
        const data = page.data;
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error("The reports response was not a list.");
        }

        const normalizedReports = data.map(normalizeReport);
        setReports(normalizedReports);
        setTotalReports(page.total);
        setLastSynced(new Date());
        setError("");
        setStatusById(
          Object.fromEntries(
            normalizedReports.map((report) => [report.id, report.status]),
          ),
        );
        getImpactMetrics()
          .then((metrics) => {
            if (!cancelled) setImpactMetrics(metrics);
          })
          .catch((metricsError) => {
            if (!cancelled) setManagementError(metricsError.message || "Could not load impact metrics.");
          });
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Could not load reports.");
      } finally {
        requestInFlight = false;
        if (!cancelled) setLoading(false);
      }
    }

    function startPolling() {
      if (intervalId) return;
      intervalId = window.setInterval(loadReports, REFRESH_INTERVAL_MS);
    }

    function stopPolling() {
      if (!intervalId) return;
      window.clearInterval(intervalId);
      intervalId = 0;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadReports();
        startPolling();
      } else {
        stopPolling();
      }
    }

    loadReports();
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshKey, assigneeFilter, overdueOnly]);

  useEffect(() => {
    let active = true;
    getUsers()
      .then((data) => {
        if (active) setUsers(data);
      })
      .catch((loadError) => {
        if (!active) return;
        if (loadError.status === 401) {
          logout();
          setManagementError("Your session expired. Please sign in again.");
          return;
        }
        setManagementError(loadError.message || "Could not load user accounts.");
      });
    return () => {
      active = false;
    };
  }, [logout]);

  const sortedReports = useMemo(
    () =>
      reports
        .filter((report) => departmentFilter === "all" || report.department === departmentFilter)
        .sort((first, second) => {
        const firstUrgency =
          urgencyOrder[first.urgencyLevel.toLowerCase()] ?? 0;
        const secondUrgency =
          urgencyOrder[second.urgencyLevel.toLowerCase()] ?? 0;

        return (
          secondUrgency - firstUrgency ||
          (second.severityScore ?? 0) - (first.severityScore ?? 0)
        );
        }),
    [reports, departmentFilter],
  );

  const canonicalReports = reports.filter((report) => !report.duplicateOf);
  const criticalCount = canonicalReports.filter(
    (report) => report.urgencyLevel.toLowerCase() === "critical",
  ).length;
  const resolvedCount = canonicalReports.filter(
    (report) => statusById[report.id] === "Resolved",
  ).length;
  const resolutionRate = impactMetrics?.resolutionRate ?? (
    canonicalReports.length ? Math.round((resolvedCount / canonicalReports.length) * 100) : 0
  );

  async function updateStatus(reportId, status, note = null, afterPhoto = null) {
    if (note && note.length > 300) {
      setStatusError("Resolution note must be 300 characters or fewer.");
      return;
    }
    if (afterPhoto?.size > 10 * 1024 * 1024) {
      setStatusError("After photo must be smaller than 10 MB.");
      return;
    }
    if (afterPhoto && !["image/jpeg", "image/png", "image/webp"].includes(afterPhoto.type)) {
      setStatusError("Choose a JPEG, PNG, or WebP after photo.");
      return;
    }
    setUpdatingReportId(reportId);
    setStatusError("");

    try {
      const updatedReport = await saveReportStatus(reportId, status, undefined, note, afterPhoto);
      setStatusById((currentStatuses) => ({
        ...currentStatuses,
        [reportId]: updatedReport.status,
      }));
      setReports((currentReports) =>
        currentReports.map((report) =>
          report.id === reportId ? { ...report, ...normalizeReport(updatedReport) } : report,
        ),
      );
      onNotify?.(`Status updated to ${updatedReport.status}.`);
    } catch (updateError) {
      if (updateError.status === 401) {
        logout();
        setStatusError("Your session expired. Please sign in again.");
        return;
      }
      setStatusError(updateError.message || "Could not update report status.");
    } finally {
      setUpdatingReportId(null);
    }
  }

  async function handleDeleteReport(report) {
    const confirmed = window.confirm(
      `Delete “${report.title}”? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingReportId(report.id);
    setStatusError("");
    try {
      await deleteReportRequest(report.id);
      setReports((currentReports) => currentReports.filter((item) => item.id !== report.id));
      setStatusById((currentStatuses) => {
        const nextStatuses = { ...currentStatuses };
        delete nextStatuses[report.id];
        return nextStatuses;
      });
      onNotify?.("Incident deleted.");
    } catch (deleteError) {
      if (deleteError.status === 401) {
        logout();
        setStatusError("Your session expired. Please sign in again.");
        return;
      }
      setStatusError(deleteError.message || "Could not delete the report.");
    } finally {
      setDeletingReportId(null);
    }
  }

  async function assignTo(reportId, assignedTo) {
    setManagementError("");
    try {
      const report = await assignReport(reportId, assignedTo || null);
      setReports((current) => current.map((item) => (
        item.id === reportId ? normalizeReport(report) : item
      )));
      onNotify?.(assignedTo ? "Incident assigned." : "Incident unassigned.");
    } catch (assignmentError) {
      if (assignmentError.status === 401) {
        logout();
        setManagementError("Your session expired. Please sign in again.");
        return;
      }
      setManagementError(assignmentError.message || "Could not assign this incident.");
    }
  }

  async function saveTriageReview(event, report) {
    event.preventDefault();
    const form = event.currentTarget;
    const category = String(new FormData(form).get("category") ?? "").trim();
    const severityScore = Number(new FormData(form).get("severityScore"));
    setTriageBusyId(report.id);
    setManagementError("");
    try {
      const updated = await updateReportTriage(report.id, { category, severityScore });
      setReports((current) => current.map((item) => item.id === report.id ? normalizeReport(updated) : item));
      onNotify?.("AI triage review saved.");
    } catch (reviewError) {
      setManagementError(reviewError.message || "Could not save the triage review.");
    } finally {
      setTriageBusyId(null);
    }
  }

  async function splitDuplicate(report) {
    try {
      await splitDuplicateReportRequest(report.id);
      setRefreshKey((key) => key + 1);
      onNotify?.("Duplicate report split into its own incident.");
    } catch (splitError) {
      setManagementError(splitError.message || "Could not split this report.");
    }
  }

  async function mergeDuplicate(report) {
    const targetId = mergeTargetById[report.id];
    if (!targetId) return;
    try {
      await mergeReportsRequest(report.id, targetId);
      setRefreshKey((key) => key + 1);
      onNotify?.("Reports merged.");
    } catch (mergeError) {
      setManagementError(mergeError.message || "Could not merge these reports.");
    }
  }

  async function changeUserRole(targetUser, role) {
    setUserActionId(targetUser.id);
    setManagementError("");
    try {
      const updatedUser = await saveUserRole(targetUser.id, role);
      setUsers((current) => current.map((item) => (
        item.id === targetUser.id ? updatedUser : item
      )));
    } catch (roleError) {
      if (roleError.status === 401) {
        logout();
        setManagementError("Your session expired. Please sign in again.");
        return;
      }
      setManagementError(roleError.message || "Could not update the user's role.");
    } finally {
      setUserActionId(null);
    }
  }

  async function removeUser(targetUser) {
    if (!window.confirm(`Delete the account for ${targetUser.name} (${targetUser.email})?`)) return;
    setUserActionId(targetUser.id);
    setManagementError("");
    try {
      await deleteUserRequest(targetUser.id);
      setUsers((current) => current.filter((item) => item.id !== targetUser.id));
      setReports((current) => current.map((report) => (
        report.assignedTo === targetUser.id ? { ...report, assignedTo: "" } : report
      )));
      onNotify?.("User account deleted.");
    } catch (deleteError) {
      if (deleteError.status === 401) {
        logout();
        setManagementError("Your session expired. Please sign in again.");
        return;
      }
      setManagementError(deleteError.message || "Could not delete the user.");
    } finally {
      setUserActionId(null);
    }
  }

  async function toggleAuditHistory(reportId) {
    if (auditReportId === reportId) {
      setAuditReportId(null);
      return;
    }
    setAuditReportId(reportId);
    if (auditsByReport[reportId]) return;
    setAuditLoadingId(reportId);
    try {
      const [entries, fieldEntries] = await Promise.all([
        getReportAudits(reportId),
        getReportFieldAudits(reportId),
      ]);
      setAuditsByReport((current) => ({ ...current, [reportId]: entries }));
      setFieldAuditsByReport((current) => ({ ...current, [reportId]: fieldEntries }));
    } catch (auditError) {
      setManagementError(auditError.message || "Could not load audit history.");
    } finally {
      setAuditLoadingId(null);
    }
  }

  function handleExportReports() {
    exportReportsCsv(sortedReports, statusById);
    const truncated = totalReports > reports.length
      ? ` (latest ${reports.length} of ${totalReports})`
      : "";
    onNotify?.(`Exported ${sortedReports.length} incidents${truncated}.`);
  }

  return (
    <section className="mx-auto w-full max-w-[1720px] space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan">
            CivicGuard staff / operations
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Municipal Incident Ops
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Monitor incoming issues and track their resolution status.
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted/70">
            {lastSynced ? `Auto-refresh · updated ${lastSynced.toLocaleTimeString()}` : "Connecting to reports API"}
          </p>
        </div>
        <button
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-brand transition hover:bg-panel-hover focus:outline-none focus:ring-2 focus:ring-brand"
          onClick={handleExportReports}
          type="button"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
            <path d="M10 3v9m0 0 3-3m-3 3L7 9m-3 5v3h12v-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
          </svg>
          Export to CSV
        </button>
      </header>

      {statusError && (
        <p className="rounded border border-alert/20 bg-alert/10 px-4 py-3 text-sm text-alert" role="alert">
          {statusError}
        </p>
      )}
      {managementError && (
        <p className="rounded border border-alert/20 bg-alert/10 px-4 py-3 text-sm text-alert" role="alert">
          {managementError}
        </p>
      )}

      {loading ? <SummarySkeletons /> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          accent="text-cyan"
          detail="Across all categories"
          icon="M4 5h16M4 12h16M4 19h16"
          tint="bg-brand/10"
          label="Total reported issues"
          value={impactMetrics?.totalSubmissions ?? reports.reduce((sum, report) => sum + report.reportCount, 0)}
        />
        <SummaryCard
          accent="text-signal"
          detail="Require urgent attention"
          icon="M12 8v4m0 4h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-13a2 2 0 0 0-3.4 0Z"
          tint="bg-signal/10"
          label="Critical issues"
          value={criticalCount}
        />
        <SummaryCard
          accent="text-resolved"
          detail={`${resolvedCount} of ${reports.length} reports resolved`}
          icon="m5 12 4 4L19 6"
          tint="bg-resolved/10"
          label="Resolution rate"
          value={`${resolutionRate}%`}
        />
        <SummaryCard
          accent="text-pending"
          detail="From receipt to AI or rules triage"
          icon="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          tint="bg-pending/10"
          label="Average time to triage"
          value={impactMetrics?.averageHoursToTriage === null || impactMetrics?.averageHoursToTriage === undefined ? "—" : `${impactMetrics.averageHoursToTriage} h`}
        />
        <SummaryCard
          accent="text-resolved"
          detail="From receipt to resolution"
          icon="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          tint="bg-resolved/10"
          label="Average time to resolve"
          value={impactMetrics?.averageHoursToResolve === null || impactMetrics?.averageHoursToResolve === undefined ? "—" : `${impactMetrics.averageHoursToResolve} h`}
        />
      </div>}

      {impactMetrics?.reportsByCategory?.length ? (
        <section aria-label="Reports by category" className="flex flex-wrap gap-2">
          {impactMetrics.reportsByCategory.map((item) => (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" key={item.category}>
              {item.category}: <strong>{item.count}</strong>
            </span>
          ))}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-line bg-panel shadow">
        <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display font-semibold text-ink">Submitted incidents</h2>
            <p className="font-mono text-[9px] text-muted">
              Choose a status and save to record the change.
            </p>
            {totalReports > reports.length ? (
              <p className="mt-1 font-mono text-[9px] text-pending" role="status">
                Showing the latest {reports.length} of {totalReports} incidents. Filters and
                CSV export apply to this page.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-muted">
              Department
              <select
                className="max-w-56 rounded border border-slate-200 dark:border-white/10 bg-deep px-2 py-2 text-xs normal-case text-ink"
                onChange={(event) => setDepartmentFilter(event.target.value)}
                value={departmentFilter}
              >
                <option value="all">All departments</option>
                {cityConfig.departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-muted">
              <input checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} type="checkbox" />
              Overdue only
            </label>
            <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-muted">
              Assigned to
              <select
                className="max-w-48 rounded border border-slate-200 dark:border-white/10 bg-deep px-2 py-2 text-xs normal-case text-ink"
                onChange={(event) => setAssigneeFilter(event.target.value)}
                value={assigneeFilter}
              >
                <option value="all">All incidents</option>
                <option value="unassigned">Unassigned</option>
                {users.filter((item) => item.role === "authority" && item.emailVerified).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-alert" role="alert">{error}</p>
            <button
              className="w-fit rounded border border-alert/30 px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-alert hover:bg-alert/10"
              onClick={() => {
                setLoading(true);
                setRefreshKey((key) => key + 1);
              }}
              type="button"
            >
              Retry now
            </button>
          </div>
        ) : sortedReports.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            No reports have been submitted yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left dark:divide-white/[0.06]">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Issue
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Urgency
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Severity
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Submitted
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Update status
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Assignment
                  </th>
                  <th scope="col" className="px-5 py-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/[0.04]">
                {sortedReports.map((report) => {
                  const urgency = report.urgencyLevel.toLowerCase();
                  const currentStatus = statusById[report.id] ?? report.status;
                  const isUpdating = updatingReportId === report.id;
                  const isDeleting = deletingReportId === report.id;

                  return (
                    <Fragment key={report.id}>
                    <tr className="align-top odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-950">
                      <td className="max-w-sm px-5 py-4">
                        <p className="font-mono text-[9px] text-muted">#{report.id.slice(0, 8).toUpperCase()}</p>
                        <p className="font-semibold text-ink">{report.title}</p>
                        <p className="mt-1 font-mono text-[9px] text-cyan">
                          {report.category}
                        </p>
                        {report.image && report.analysis && (
                          report.analysis.photoQuality !== "ok" ||
                          report.analysis.photoMatchesCategory === false
                        ) ? (
                          <span className="mt-2 inline-flex rounded-full border border-pending/25 bg-pending/10 px-2.5 py-1 text-xs font-semibold text-pending">
                            Photo needs review
                            {report.analysis.photoQuality && report.analysis.photoQuality !== "ok"
                              ? ` · ${report.analysis.photoQuality}`
                              : ""}
                            {report.analysis.photoMatchesCategory === false ? " · category mismatch" : ""}
                          </span>
                        ) : null}
                        {report.analysis?.riskToVulnerable ? (
                          <span
                            className="ml-2 mt-2 inline-flex rounded-full border border-signal/25 bg-signal/10 px-2.5 py-1 text-xs font-semibold text-signal"
                            title={report.analysis.riskReason || "This issue may put vulnerable users at risk."}
                          >
                            Vulnerable users at risk
                          </span>
                        ) : null}
                        {report.reportCount > 1 ? (
                          <p className="mt-1 text-xs font-medium text-cyan">
                            {report.confirmationCount} people confirmed this
                          </p>
                        ) : null}
                        <button
                          className="mt-2 min-h-11 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold text-brand hover:bg-panel-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          onClick={() => openPrintWorkOrder(report, currentStatus, onNotify)}
                          type="button"
                        >
                          Print work order
                        </button>
                        <p className="mt-1 text-[10px] text-muted">
                          {report.department} · {formatTimeRemaining(report.remainingMs)} · due {formatTimestamp(report.slaDueAt)}
                          {report.overdue ? <span className="ml-2 inline-flex rounded-full bg-signal/10 px-2 py-0.5 font-semibold text-signal">Overdue</span> : null}
                        </p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
                          {report.description}
                        </p>
                        {report.status === "Resolved" && (report.image?.url || report.afterPhoto?.url) ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {report.image?.url ? <img alt="Before work began" className="aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" src={report.image.url} /> : null}
                            {report.afterPhoto?.url ? <img alt="After the issue was resolved" className="aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" src={report.afterPhoto.url} /> : null}
                          </div>
                        ) : null}
                        {report.afterNote ? <p className="mt-2 rounded-lg bg-deep p-3 text-xs leading-5 text-muted">Resolution note: {report.afterNote}</p> : null}
                        {report.triageSuggestion && (
                          <p className="mt-2 text-[10px] text-muted">
                            AI suggested {report.triageSuggestion.category} / severity {report.triageSuggestion.severityScore ?? "—"};
                            {" "}staff set {report.category} / severity {report.severityScore ?? "—"}.
                          </p>
                        )}
                        {report.analysis?.confidence !== undefined ? (
                          <p className="mt-1 text-[10px] text-muted">
                            AI confidence: {Math.round(report.analysis.confidence * 100)}%
                            {report.analysisStatus === "triaged-by-rules" ? " · Triaged by rules" : ""}
                          </p>
                        ) : null}
                        {report.analysis?.translatedDescription && report.analysis.detectedLanguage !== "en" ? (
                          <p className="mt-1 text-xs italic text-muted">
                            English translation: {report.analysis.translatedDescription}
                          </p>
                        ) : null}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] font-semibold text-cyan">Review AI triage</summary>
                          <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => saveTriageReview(event, report)}>
                            <label className="text-[9px] text-muted">
                              Category
                              <input className="mt-1 block w-36 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" defaultValue={report.category} name="category" required />
                            </label>
                            <label className="text-[9px] text-muted">
                              Severity
                              <select className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" defaultValue={report.severityScore ?? 3} name="severityScore">
                                {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}
                              </select>
                            </label>
                            <button className="rounded bg-cyan-700 px-2.5 py-1.5 text-[9px] font-semibold text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50" disabled={triageBusyId === report.id} type="submit">
                              {triageBusyId === report.id ? "Saving…" : "Save review"}
                            </button>
                          </form>
                        </details>
                        {report.duplicateOf ? (
                          <button className="mt-2 rounded border border-amber-400/40 px-2 py-1 text-[9px] font-semibold text-amber-700 dark:text-amber-300" onClick={() => splitDuplicate(report)} type="button">
                            Split from parent
                          </button>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label className="sr-only" htmlFor={`merge-${report.id}`}>Merge {report.title} into another incident</label>
                            <select className="max-w-40 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" id={`merge-${report.id}`} onChange={(event) => setMergeTargetById((current) => ({ ...current, [report.id]: event.target.value }))} value={mergeTargetById[report.id] ?? ""}>
                              <option value="">Merge into…</option>
                              {reports.filter((target) => target.id !== report.id && !target.duplicateOf && target.category.toLowerCase() === report.category.toLowerCase() && target.status !== "Resolved").map((target) => (
                                <option key={target.id} value={target.id}>#{target.id.slice(0, 8).toUpperCase()} · {target.category}</option>
                              ))}
                            </select>
                            <button className="rounded border border-cyan/30 px-2 py-1 text-[9px] font-semibold text-cyan disabled:opacity-40" disabled={!mergeTargetById[report.id]} onClick={() => mergeDuplicate(report)} type="button">
                              Merge
                            </button>
                          </div>
                        )}
                        <button
                          className="mt-2 font-mono text-[9px] uppercase tracking-wide text-cyan hover:text-ink"
                          onClick={() => toggleAuditHistory(report.id)}
                          type="button"
                        >
                          {auditReportId === report.id ? "Hide audit history" : "Audit history"}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ${urgencyStyles[urgency] ?? "border-slate-200 dark:border-white/10 bg-panel-hover text-muted"}`}
                        >
                          {report.urgencyLevel}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-ink">
                        {report.severityScore === null
                          ? "Not rated"
                          : `${report.severityScore} / 5`}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[9px] text-muted">
                        {formatTimestamp(report.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold ${statusStyles[currentStatus]}`}
                        >
                          {currentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <label className="sr-only" htmlFor={`status-${report.id}`}>
                          Update status for {report.title}
                        </label>
                        <form
                          className="min-w-40 space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const formData = new FormData(event.currentTarget);
                            const image = formData.get("afterPhoto");
                            updateStatus(
                              report.id,
                              String(formData.get("status")),
                              String(formData.get("afterNote") ?? "").trim() || null,
                              image instanceof File && image.size > 0 ? image : null,
                            );
                          }}
                        >
                          <label className="sr-only" htmlFor={`status-${report.id}`}>
                            Update status for {report.title}
                          </label>
                          <select
                            className="min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-wait disabled:opacity-50"
                            defaultValue={currentStatus}
                            disabled={isUpdating}
                            id={`status-${report.id}`}
                            key={`${report.id}-${currentStatus}`}
                            name="status"
                          >
                            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                          <details>
                            <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-brand focus:outline-none focus:ring-2 focus:ring-brand">
                              Add resolution proof (optional)
                            </summary>
                            <label className="block text-xs text-muted" htmlFor={`after-note-${report.id}`}>
                              Resolution note
                              <textarea
                                className="mt-1 min-h-20 w-full rounded-lg border border-line bg-panel-raised p-2 text-sm text-ink"
                                id={`after-note-${report.id}`}
                                maxLength={300}
                                name="afterNote"
                                placeholder="Briefly describe the completed work"
                              />
                            </label>
                            <label className="mt-2 block text-xs text-muted" htmlFor={`after-photo-${report.id}`}>
                              After photo (JPEG, PNG, or WebP; up to 10 MB)
                              <input
                                accept="image/jpeg,image/png,image/webp"
                                className="mt-1 block min-h-11 w-full text-xs"
                                id={`after-photo-${report.id}`}
                                name="afterPhoto"
                                type="file"
                              />
                            </label>
                          </details>
                          <button
                            className="min-h-11 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 dark:text-slate-900"
                            disabled={isUpdating}
                            type="submit"
                          >
                            {isUpdating ? "Saving…" : "Save status"}
                          </button>
                        </form>
                      </td>
                      <td className="px-5 py-4">
                        <label className="sr-only" htmlFor={`assignee-${report.id}`}>
                          Assign {report.title}
                        </label>
                        <select
                          className="max-w-40 rounded border border-slate-200 dark:border-white/10 bg-deep px-2 py-2 text-xs text-ink disabled:opacity-50"
                          disabled={userActionId === report.id}
                          id={`assignee-${report.id}`}
                          onChange={(event) => assignTo(report.id, event.target.value)}
                          value={report.assignedTo}
                        >
                          <option value="">Unassigned</option>
                          {users.filter((item) => item.role === "authority" && item.emailVerified).map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          aria-label={`Delete ${report.title}`}
                          className="rounded border border-alert/20 bg-alert/5 px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-alert transition hover:border-alert/40 hover:bg-alert/10 disabled:cursor-wait disabled:opacity-50"
                          disabled={isDeleting}
                          onClick={() => handleDeleteReport(report)}
                          type="button"
                        >
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                    {auditReportId === report.id && (
                      <tr>
                        <td className="bg-deep/40 px-5 py-4" colSpan={8}>
                          <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan">
                            Status change history
                          </h3>
                          {auditLoadingId === report.id ? (
                            <p className="text-xs text-muted">Loading audit history…</p>
                          ) : (auditsByReport[report.id] ?? []).length === 0 ? (
                            <p className="text-xs text-muted">No status changes recorded.</p>
                          ) : (
                            <ul className="space-y-2">
                              {auditsByReport[report.id].map((entry) => (
                                <li className="text-xs text-muted" key={entry.id}>
                                  <span className="font-semibold text-ink">{entry.previousStatus ?? "New"} → {entry.newStatus}</span>
                                  {" · "}{entry.actorEmail}{" · "}{formatTimestamp(entry.createdAt)}
                                  {entry.note ? <p className="mt-1">{entry.note}</p> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(fieldAuditsByReport[report.id] ?? []).length > 0 ? (
                            <div className="mt-4">
                              <h3 className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan">AI triage overrides</h3>
                              <ul className="space-y-2">
                                {fieldAuditsByReport[report.id].map((entry) => (
                                  <li className="text-xs text-muted" key={entry.id}>
                                    <span className="font-semibold text-ink">{entry.field}: {entry.oldValue || "—"} → {entry.newValue}</span>
                                    {" · "}{entry.actorEmail}{" · "}{formatTimestamp(entry.createdAt)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-panel shadow">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display font-semibold text-ink">User management</h2>
          <p className="mt-1 font-mono text-[9px] text-muted">
            Manage citizen and authority account access.
          </p>
        </div>
        {users.length === 0 ? (
          <p className="p-5 text-sm text-muted">No user accounts found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/[0.06] text-left">
              <thead className="bg-deep/60">
                <tr>
                  <th className="px-5 py-3 font-mono text-[9px] uppercase tracking-wide text-muted" scope="col">User</th>
                  <th className="px-5 py-3 font-mono text-[9px] uppercase tracking-wide text-muted" scope="col">Verification</th>
                  <th className="px-5 py-3 font-mono text-[9px] uppercase tracking-wide text-muted" scope="col">Role</th>
                  <th className="px-5 py-3 font-mono text-[9px] uppercase tracking-wide text-muted" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {users.map((targetUser) => {
                  const busy = userActionId === targetUser.id;
                  const isCurrentUser = targetUser.id === currentUser?.id;
                  return (
                    <tr key={targetUser.id}>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-ink">{targetUser.name}</p>
                        <p className="text-xs text-muted">{targetUser.email}</p>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {targetUser.emailVerified ? "Verified" : "Pending"}
                      </td>
                      <td className="px-5 py-4">
                        <label className="sr-only" htmlFor={`role-${targetUser.id}`}>Role for {targetUser.name}</label>
                        <select
                          className="rounded border border-slate-200 dark:border-white/10 bg-deep px-2 py-2 text-xs text-ink disabled:opacity-50"
                          disabled={busy || isCurrentUser}
                          id={`role-${targetUser.id}`}
                          onChange={(event) => changeUserRole(targetUser, event.target.value)}
                          value={targetUser.role}
                        >
                          <option value="citizen">Citizen</option>
                          <option value="authority">Authority</option>
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          className="rounded border border-alert/20 bg-alert/5 px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-alert disabled:opacity-50"
                          disabled={busy || isCurrentUser}
                          onClick={() => removeUser(targetUser)}
                          type="button"
                        >
                          {busy ? "Saving…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
