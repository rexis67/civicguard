import { useEffect, useMemo, useState } from "react";
import {
  deleteReport as deleteReportRequest,
  getReports,
  updateReportStatus as saveReportStatus,
} from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const REFRESH_INTERVAL_MS = 5000;
const statuses = ["Pending", "In Progress", "Resolved"];
const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };

const urgencyStyles = {
  critical: "border-alert/30 bg-alert/10 text-alert",
  high: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  medium: "border-yellow-400/25 bg-yellow-400/10 text-yellow-300",
  low: "border-mint/25 bg-mint/10 text-mint",
};

const statusStyles = {
  Pending: "bg-yellow-400/10 text-yellow-300",
  "In Progress": "bg-cyan/10 text-cyan",
  Resolved: "bg-mint/10 text-mint",
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
  };
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

function SummaryCard({ label, value, detail, accent }) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-panel p-5 shadow-lg">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-display text-3xl font-bold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </article>
  );
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportReportsCsv(reports, statusById) {
  const columns = ["ID", "Category", "Severity", "Urgency", "Status", "Date"];
  const rows = reports.map((report) => [
    report.id,
    report.category,
    report.severityScore ?? "",
    report.urgencyLevel,
    statusById[report.id] ?? report.status,
    formatTimestamp(report.timestamp),
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
  const { token, logout } = useAuth();
  const [reports, setReports] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [updatingReportId, setUpdatingReportId] = useState(null);
  const [deletingReportId, setDeletingReportId] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    let intervalId = 0;

    async function loadReports() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const data = await getReports();
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error("The reports response was not a list.");
        }

        const normalizedReports = data.map(normalizeReport);
        setReports(normalizedReports);
        setLastSynced(new Date());
        setError("");
        setStatusById(
          Object.fromEntries(
            normalizedReports.map((report) => [report.id, report.status]),
          ),
        );
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
  }, [refreshKey]);

  const sortedReports = useMemo(
    () =>
      [...reports].sort((first, second) => {
        const firstUrgency =
          urgencyOrder[first.urgencyLevel.toLowerCase()] ?? 0;
        const secondUrgency =
          urgencyOrder[second.urgencyLevel.toLowerCase()] ?? 0;

        return (
          secondUrgency - firstUrgency ||
          (second.severityScore ?? 0) - (first.severityScore ?? 0)
        );
      }),
    [reports],
  );

  const criticalCount = reports.filter(
    (report) => report.urgencyLevel.toLowerCase() === "critical",
  ).length;
  const resolvedCount = reports.filter(
    (report) => statusById[report.id] === "Resolved",
  ).length;
  const resolutionRate = reports.length
    ? Math.round((resolvedCount / reports.length) * 100)
    : 0;

  async function updateStatus(reportId, status) {
    setUpdatingReportId(reportId);
    setStatusError("");

    try {
      const updatedReport = await saveReportStatus(reportId, status, token);
      setStatusById((currentStatuses) => ({
        ...currentStatuses,
        [reportId]: updatedReport.status,
      }));
      setReports((currentReports) =>
        currentReports.map((report) =>
          report.id === reportId ? { ...report, status: updatedReport.status } : report,
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
      await deleteReportRequest(report.id, token);
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
          className="inline-flex w-fit items-center gap-2 rounded border border-cyan/25 bg-cyan/10 px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan transition hover:border-cyan/50 hover:bg-cyan/15 focus:outline-none focus:ring-2 focus:ring-cyan/40"
          onClick={() => exportReportsCsv(reports, statusById)}
          type="button"
        >
          <span aria-hidden="true">⇩</span>
          Export to CSV
        </button>
      </header>

      {statusError && (
        <p className="rounded border border-alert/20 bg-alert/10 px-4 py-3 text-sm text-alert" role="alert">
          {statusError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          accent="text-cyan"
          detail="Across all categories"
          label="Total reported issues"
          value={reports.length}
        />
        <SummaryCard
          accent="text-alert"
          detail="Require urgent attention"
          label="Critical issues"
          value={criticalCount}
        />
        <SummaryCard
          accent="text-mint"
          detail={`${resolvedCount} of ${reports.length} reports resolved`}
          label="Resolution rate"
          value={`${resolutionRate}%`}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-panel shadow-xl">
        <div className="flex flex-col gap-1 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display font-semibold text-ink">Submitted incidents</h2>
          <p className="font-mono text-[9px] text-muted">
            Status changes are saved automatically.
          </p>
        </div>

        {loading ? (
          <p aria-live="polite" className="p-6 text-sm text-muted">
            Loading incident data…
          </p>
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
            <table className="min-w-full divide-y divide-white/[0.06] text-left">
              <thead className="bg-deep/60">
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
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {sortedReports.map((report) => {
                  const urgency = report.urgencyLevel.toLowerCase();
                  const currentStatus = statusById[report.id] ?? report.status;
                  const isUpdating = updatingReportId === report.id;
                  const isDeleting = deletingReportId === report.id;

                  return (
                    <tr className="align-top" key={report.id}>
                      <td className="max-w-sm px-5 py-4">
                        <p className="font-semibold text-ink">{report.title}</p>
                        <p className="mt-1 font-mono text-[9px] text-cyan">
                          {report.category}
                        </p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
                          {report.description}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase ring-1 ring-inset ${urgencyStyles[urgency] ?? "border-white/10 bg-panel-hover text-muted"}`}
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
                        <div aria-label={`Set status for ${report.title}`} className="flex flex-wrap gap-1.5">
                          {statuses.map((status) => (
                            <button
                              aria-pressed={currentStatus === status}
                              className={`rounded border px-2 py-1 font-mono text-[9px] font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan/40 disabled:cursor-wait disabled:opacity-50 ${
                                currentStatus === status
                                  ? "border-cyan bg-cyan text-[#06202a]"
                                  : "border-white/10 bg-panel-raised text-muted hover:border-cyan/30 hover:text-ink"
                              }`}
                              disabled={isUpdating}
                              key={status}
                              onClick={() => updateStatus(report.id, status)}
                              type="button"
                            >
                              {status}
                            </button>
                          ))}
                        </div>
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
