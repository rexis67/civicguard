import { useEffect, useMemo, useRef, useState } from "react";
import { confirmReport, getReportsPage, retryReportTriage } from "../services/api.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { IncidentMap } from "./IncidentMap.jsx";
import ReportConfirmationButton from "./ReportConfirmationButton.jsx";
import cityConfig from "../../config/city.json";

const REFRESH_INTERVAL_MS = 5000;

const urgencyStyles = {
  low: "border-mint/25 bg-mint/10 text-mint",
  medium: "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-400/25 dark:bg-yellow-400/10 dark:text-yellow-300",
  high: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  critical: "border-alert/30 bg-alert/10 text-alert",
};

const categoryStyles = {
  pothole: "text-muted",
  streetlight: "text-muted",
  accessibility: "text-muted",
  garbage: "text-muted",
};

const PRIMARY_CATEGORIES = cityConfig.categories;

function getSeverity(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const severityByLabel = {
      low: 1,
      minor: 1,
      medium: 3,
      moderate: 3,
      high: 4,
      severe: 4,
      critical: 5,
    };

    if (normalized in severityByLabel) return severityByLabel[normalized];
  }

  const score = Number(value);
  return Number.isFinite(score) && score >= 1 && score <= 5
    ? Math.round(score)
    : null;
}

function getUrgency(value, severity) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }

  if (severity === null) return "medium";
  if (severity >= 5) return "critical";
  if (severity >= 4) return "high";
  if (severity >= 3) return "medium";
  return "low";
}

function getCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getReportDetails(report) {
  const analysis =
    report.analysis && typeof report.analysis === "object" ? report.analysis : {};
  const category = String(report.category ?? analysis.category ?? "Uncategorized");
  const description = String(
    report.description ?? analysis.summary ?? analysis.description ?? "No description provided.",
  );
  const severity = getSeverity(
    analysis.severityScore ??
      analysis.severity_score ??
      analysis.severity ??
      report.severityScore ??
      report.severity,
  );
  const urgency = getUrgency(
    analysis.urgencyLevel ?? analysis.urgency ?? report.urgencyLevel ?? report.urgency,
    severity,
  );
  const timestamp = report.timestamp ?? report.createdAt ?? report.created_at;
  const date = timestamp ? new Date(timestamp) : null;
  const analysisStatus =
    ["pending", "failed", "triaged-by-rules"].includes(report.analysisStatus)
      ? report.analysisStatus
      : "complete";
  const latitude = getCoordinate(report.location?.lat ?? report.latitude);
  const longitude = getCoordinate(report.location?.lng ?? report.longitude);
  const hasLocation =
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  return {
    id: report.id,
    title: String(
      report.title ?? analysis.title ?? analysis.issueTitle ?? `${category} report`,
    ),
    category,
    district: String(report.district ?? "Unassigned"),
    description,
    severity,
    urgency,
    analysisStatus,
    status: typeof report.status === "string" ? report.status : "Pending",
    reportCount: Number(report.reportCount) > 0 ? Number(report.reportCount) : 1,
    confirmationCount: Number(report.confirmationCount) > 0 ? Number(report.confirmationCount) : 0,
    tags: Array.isArray(analysis.tags) ? analysis.tags.filter((tag) => typeof tag === "string") : [],
    hasImage: Boolean(report.image),
    imageUrl: typeof report.image?.url === "string" ? report.image.url : null,
    lat: hasLocation ? latitude : null,
    lng: hasLocation ? longitude : null,
    timestamp:
      date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(date)
        : "Time unavailable",
  };
}

function SeverityIndicator({ score }) {
  const activeColor = score >= 5 ? "bg-signal" : score >= 3 ? "bg-brand" : "bg-resolved";

  return (
    <div aria-label={score ? `Severity ${score} out of 5` : "Severity not rated"} role="img">
      <div aria-hidden="true" className="mt-2 grid h-1.5 grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            className={`rounded-full ${
              score !== null && level <= score ? activeColor : "bg-slate-200 dark:bg-white/10"
            }`}
            key={level}
          />
        ))}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div aria-label="Loading incident stream" className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" role="status">
      {[0, 1, 2].map((item) => (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-panel p-5" key={item}>
          <div className="flex items-center justify-between">
            <span className="civic-skeleton h-3 w-24 rounded" />
            <span className="civic-skeleton h-6 w-20 rounded-full" />
          </div>
          <div className="civic-skeleton mt-5 h-5 w-3/4 rounded" />
          <div className="civic-skeleton mt-3 h-3 w-1/3 rounded" />
          <div className="civic-skeleton mt-6 h-16 rounded-lg" />
          <div className="civic-skeleton mt-5 h-3 w-full rounded" />
          <div className="civic-skeleton mt-2 h-3 w-2/3 rounded" />
        </div>
      ))}
      <span className="sr-only">Loading incident stream…</span>
    </div>
  );
}

export default function ReportFeed({
  onSyncedReports,
  onCreateReport,
  submittedReports = [],
}) {
  const { darkMode } = useTheme();
  const [reports, setReports] = useState([]);
  const [totalReports, setTotalReports] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [urgencyFilter, setUrgencyFilter] = useState("All urgencies");
  const [districtFilter, setDistrictFilter] = useState("All districts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSynced, setLastSynced] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [triageErrors, setTriageErrors] = useState({});
  const [retryingReportId, setRetryingReportId] = useState(null);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const submittedReportsRef = useRef(submittedReports);
  const onSyncedReportsRef = useRef(onSyncedReports);

  useEffect(() => {
    submittedReportsRef.current = submittedReports;
    onSyncedReportsRef.current = onSyncedReports;
  }, [submittedReports, onSyncedReports]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    let intervalId = 0;

    async function loadReports() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const page = await getReportsPage();
        const data = page.data;
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error("The reports response was not a list.");
        }

        const reportIds = new Set(data.map((report) => report.id));
        const syncedIds = submittedReportsRef.current
          .filter((report) => reportIds.has(report.id))
          .map((report) => report.id);
        onSyncedReportsRef.current?.(syncedIds);
        setReports(data);
        setTotalReports(page.total);
        setError("");
        setLastSynced(new Date());
      } catch (fetchError) {
        if (!cancelled) setError(fetchError.message || "Could not load reports.");
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

  const allReports = useMemo(() => {
    const merged = new Map(submittedReports.map((report) => [report.id, report]));
    for (const report of reports) merged.set(report.id, report);
    return [...merged.values()];
  }, [reports, submittedReports]);
  const reportDetails = useMemo(
    () =>
      [...allReports]
        .sort((left, right) => {
          const leftTime = new Date(left.timestamp ?? left.createdAt ?? 0).getTime() || 0;
          const rightTime = new Date(right.timestamp ?? right.createdAt ?? 0).getTime() || 0;
          return rightTime - leftTime;
        })
        .map(getReportDetails),
    [allReports],
  );
  const categories = useMemo(() => {
    const counts = new Map();
    for (const report of reportDetails) {
      counts.set(report.category, (counts.get(report.category) ?? 0) + 1);
    }

    const customCategories = [...counts.keys()]
      .filter((category) => !PRIMARY_CATEGORIES.includes(category))
      .sort((left, right) => left.localeCompare(right));

    return ["All", ...PRIMARY_CATEGORIES.filter((category) => counts.has(category)), ...customCategories];
  }, [reportDetails]);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reportDetails.filter((report) => {
      const matchesQuery = !query ||
        [report.id, report.category, report.title, report.description, report.urgency]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesCategory =
        categoryFilter === "All" ||
        report.category.toLowerCase() === categoryFilter.toLowerCase();
      const matchesUrgency =
        urgencyFilter === "All urgencies" ||
        report.urgency.toLowerCase() === urgencyFilter.toLowerCase();
      const matchesDistrict =
        districtFilter === "All districts" || report.district === districtFilter;

      return matchesQuery && matchesCategory && matchesUrgency && matchesDistrict;
    });
  }, [reportDetails, search, categoryFilter, urgencyFilter, districtFilter]);
  const reportGridColumns =
    filteredReports.length === 4 ? "lg:grid-cols-2" : "lg:grid-cols-3";
  const mappedReports = useMemo(
    () =>
      filteredReports.filter(
        (report) => Number.isFinite(report.lat) && Number.isFinite(report.lng),
      ),
    [filteredReports],
  );
  const districts = useMemo(
    () => ["All districts", ...new Set(reportDetails.map((report) => report.district).filter(Boolean))],
    [reportDetails],
  );

  async function handleConfirmReport(reportId) {
    const result = await confirmReport(reportId);
    setReports((current) => current.map((report) => (
      report.id === reportId
        ? {
            ...report,
            reportCount: result.reportCount ?? report.reportCount,
            confirmationCount: result.confirmationCount ?? report.confirmationCount,
            urgencyLevel: result.urgencyLevel ?? report.urgencyLevel,
          }
        : report
    )));
    return result;
  }

  async function handleRetryTriage(reportId) {
    setRetryingReportId(reportId);
    setTriageErrors((current) => ({ ...current, [reportId]: "" }));
    try {
      const updatedReport = await retryReportTriage(reportId);
      setReports((current) => current.map((report) => (
        report.id === reportId ? updatedReport : report
      )));
    } catch (retryError) {
      setTriageErrors((current) => ({
        ...current,
        [reportId]: retryError.message || "Could not retry AI triage.",
      }));
    } finally {
      setRetryingReportId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1720px]">
      <section aria-labelledby="home-heading" className="mb-8 grid gap-6 rounded-xl border border-line bg-panel p-5 shadow-sm sm:p-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] lg:items-center lg:p-10">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
            A clearer route to local action
          </p>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl" id="home-heading">
            Better neighborhoods start with being heard.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base">
            Report a local issue, help the right team prioritize it, and follow its progress through resolution.
          </p>
          <button
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan px-5 py-3 text-sm font-semibold text-white shadow transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:text-slate-900 dark:focus:ring-offset-slate-900"
            onClick={onCreateReport}
            type="button"
          >
            Report an issue
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
              <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          </button>
        </div>
        <ul className="grid gap-3 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          {[
            ["No account needed", "Share a concern without creating a profile."],
            ["Prioritized for action", "Reports are triaged to help teams focus."],
            ["Tracked to resolution", "Follow updates with a private tracking code."],
          ].map(([title, detail], index) => (
            <li className="flex items-start gap-3" key={title}>
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-deep font-mono text-[10px] font-semibold text-brand">
                0{index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mb-5 border-b border-line px-1 pb-4">
        <div className="mx-auto flex max-w-[1720px] flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span className="relative grid h-3 w-3 place-items-center rounded-full bg-resolved/15">
                <span className="relative h-1.5 w-1.5 rounded-full bg-resolved" />
              </span>
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
                Live Incident Stream
              </h1>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-panel-hover px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              Active incidents
              <span className="rounded bg-deep px-2 py-0.5 font-semibold text-brand">
                {reportDetails.length} reports
              </span>
            </div>
            <p className="hidden items-center gap-2 font-mono text-[10px] text-muted md:flex">
              <span aria-hidden="true" className="text-resolved">●</span> Civic reporting network
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-panel-raised px-3.5 py-1.5 font-mono text-[10px] text-ink shadow-sm">
            {loading ? (
              <span className="h-2 w-2 rounded-full bg-brand animate-pulse" />
            ) : error ? (
              <span className="h-2 w-2 rounded-full bg-signal" />
            ) : (
              <span className="civic-radar-dot" />
            )}
            <span className="font-medium">{loading ? "Connecting to report API" : error ? "Auto-sync paused · API issue" : "Auto-sync · 5 sec"}</span>
          </div>
        </div>
      </div>

      {isOffline && (
        <p
          aria-live="polite"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/[0.06] dark:text-amber-300"
          role="status"
        >
          You appear to be offline. Reports will sync when your connection returns.
        </p>
      )}

      {totalReports > reports.length && (
        <p className="mb-5 rounded-xl border border-line bg-panel px-4 py-3 text-xs text-muted" role="status">
          Showing the {reports.length} most recent of {totalReports} incidents. Older
          incidents are retained and can be retrieved through the paginated API.
        </p>
      )}

      <div className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <span className="sr-only">Search by keyword, incident ID, or category</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">⌕</span>
            <input
              className="min-h-11 w-full rounded-lg border border-line bg-panel py-2.5 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search incidents..."
              type="search"
              value={search}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs text-muted">
              <span className="text-cyan">!</span>
              <span>Urgency:</span>
              <select
                aria-label="Filter incidents by urgency"
                className="cursor-pointer bg-transparent font-mono text-[10px] font-semibold text-cyan outline-none"
                onChange={(event) => setUrgencyFilter(event.target.value)}
                value={urgencyFilter}
              >
                {["All urgencies", "Critical", "High", "Medium", "Low"].map((urgency) => (
                  <option className="bg-panel text-ink" key={urgency} value={urgency}>
                    {urgency}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs text-muted">
              <span className="text-mint">◉</span>
              <span>District:</span>
              <select
                aria-label="Filter incidents by district"
                className="max-w-40 cursor-pointer bg-transparent font-mono text-[10px] font-semibold text-mint outline-none"
                onChange={(event) => setDistrictFilter(event.target.value)}
                value={districtFilter}
              >
                {districts.map((district) => (
                  <option className="bg-panel text-ink" key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div aria-label="Filter reports by category" className="flex gap-2 overflow-x-auto pb-1" role="group">
          {categories.map((category) => {
            const count =
              category === "All"
                ? reportDetails.length
                : reportDetails.filter(
                    (report) => report.category.toLowerCase() === category.toLowerCase(),
                  ).length;
            const isSelected = categoryFilter === category;

            return (
              <button
                aria-pressed={isSelected}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[10px] transition active:scale-[0.98] ${
                  isSelected
                    ? "bg-cyan font-semibold text-white shadow dark:text-slate-900"
                    : "bg-panel text-muted hover:bg-panel-hover hover:text-ink"
                }`}
                key={category}
                onClick={() => setCategoryFilter(category)}
                type="button"
              >
                {category}
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${isSelected ? "bg-deep/15" : "bg-panel-hover text-ink"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-line bg-panel shadow">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-brand">
              Incident map
            </p>
            <p className="mt-1 font-mono text-[9px] text-muted/70">
              {mappedReports.length} of {filteredReports.length} filtered{" "}
              {filteredReports.length === 1 ? "incident" : "incidents"} pinned
            </p>
          </div>
          <p className="hidden font-mono text-[9px] text-muted/60 sm:block">
            Select a pin to view the incident
          </p>
        </div>

        <div className="civic-map-content">
          <IncidentMap
            darkMode={darkMode}
            onConfirm={handleConfirmReport}
            onSelect={(reportId) => {
              const card = document.getElementById(`report-${reportId}`);
              const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              card?.scrollIntoView({
                behavior: reduceMotion ? "auto" : "smooth",
                block: "center",
              });
            }}
            reports={mappedReports}
          />
          {mappedReports.length === 0 && (
            <div className="civic-map-empty">
            <p className="max-w-md font-mono text-[10px] leading-5 text-muted/70">
              No mapped incidents match these filters. Reports submitted without a
              location still appear in the list below.
            </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-alert/20 bg-alert/10 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="text-sm text-alert" role="alert">
            {error}
            {reports.length > 0
              ? " Showing the last successful sync."
              : " Automatic refresh will retry shortly."}
          </p>
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
      )}

      {loading && reports.length === 0 && submittedReports.length === 0 ? (
        <FeedSkeleton />
      ) : (
        <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${reportGridColumns}`}>
          {filteredReports.map((report, index) => {
            const categoryStyle =
              categoryStyles[report.category.toLowerCase()] ??
              "text-muted";
            const urgencyStyle = urgencyStyles[report.urgency] ?? urgencyStyles.medium;

            return (
              <article
                aria-label={`${report.title}. ${report.category}. Severity ${report.severity ?? "not rated"} out of 5. ${report.status}.`}
                className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-panel shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-panel-hover ${
                  report.urgency === "critical"
                    ? "border-signal/40 civic-glow-critical"
                    : "border-line"
                }`}
                id={report.id ? `report-${report.id}` : undefined}
                key={report.id ?? `${report.title}-${report.timestamp}-${index}`}
              >
                <div className="border-b border-line bg-panel px-5 pb-4 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-mono text-[9px] text-muted">
                      <span className="font-semibold tracking-wide text-muted">
                        #{report.id ? report.id.slice(0, 8).toUpperCase() : "NEW"}
                      </span>
                      <span className="text-slate-400 dark:text-white/20">•</span>
                      <time>{report.timestamp}</time>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide ${
                        report.analysisStatus === "pending"
                          ? "border-cyan/25 bg-cyan/10 text-cyan"
                          : report.analysisStatus === "failed"
                            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300"
                            : urgencyStyle
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full bg-current ${
                          report.analysisStatus === "pending" ? "animate-pulse" : ""
                        }`}
                      />
                      {report.analysisStatus === "pending"
                        ? "Analyzing"
                        : report.analysisStatus === "failed"
                          ? "Manual review"
                          : report.urgency}
                    </span>
                  </div>
                  <h2 className="mt-3 font-display text-lg font-semibold leading-snug text-ink transition-colors group-hover:text-brand">
                    {report.title}
                  </h2>
                  <p className={`mt-2 font-mono text-[10px] ${categoryStyle}`}>
                    ◈ {report.category}
                  </p>
                  {report.district !== "Unassigned" && (
                    <p className="mt-1 font-mono text-[9px] text-muted/80">
                      ◉ {report.district}
                    </p>
                  )}
                  {report.reportCount > 1 ? (
                    <p className="mt-1 text-xs text-muted">
                      {report.reportCount} reports linked to this incident
                    </p>
                  ) : null}
                  {!String(report.id ?? "").startsWith("optimistic-") ? (
                    <div className="mt-4">
                      <ReportConfirmationButton
                        confirmationCount={report.confirmationCount}
                        onConfirmed={(result) => {
                          setReports((current) => current.map((item) => (
                            item.id === report.id
                              ? {
                                  ...item,
                                  reportCount: result.reportCount ?? item.reportCount,
                                  confirmationCount: result.confirmationCount ?? item.confirmationCount,
                                  urgencyLevel: result.urgencyLevel ?? item.urgencyLevel,
                                }
                              : item
                          )));
                        }}
                        reportId={report.id}
                      />
                    </div>
                  ) : null}
                  {report.analysisStatus === "triaged-by-rules" ? (
                    <p className="mt-1 font-mono text-[9px] text-amber-700 dark:text-amber-300">
                      Triaged by rules · staff can review
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-4 px-5 py-4">
                  <div className="rounded-lg border border-line bg-deep p-3">
                    <div className="flex items-center justify-between gap-3 font-mono text-[9px]">
                      <span className="text-muted">ISSUE SEVERITY</span>
                      <span className={report.severity >= 5 ? "text-alert" : report.severity >= 3 ? "text-cyan" : "text-mint"}>
                        {report.analysisStatus === "pending"
                          ? "ANALYZING…"
                          : report.severity === null
                            ? "UNRATED"
                            : `${report.severity} / 5`}
                      </span>
                    </div>
                    <SeverityIndicator score={report.severity} />
                  </div>

                  <p className="flex-1 whitespace-pre-line text-sm leading-6 text-muted line-clamp-4">
                  {report.description}
                  </p>

                  {report.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {report.tags.slice(0, 4).map((tag) => (
                        <span
                          className="rounded border border-slate-200 dark:border-white/[0.06] bg-panel-raised px-2 py-1 font-mono text-[9px] text-muted"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {report.imageUrl ? (
                    <img
                      alt={`Evidence for ${report.title}`}
                      className="h-36 w-full rounded-lg border border-slate-200 dark:border-white/[0.06] object-cover"
                      loading="lazy"
                      src={report.imageUrl}
                    />
                  ) : report.hasImage ? (
                    <div className="flex items-center gap-2 rounded-lg border border-cyan/10 bg-cyan/[0.04] px-3 py-2 font-mono text-[9px] text-cyan">
                      <span aria-hidden="true">▧</span>
                      Evidence photo attached
                    </div>
                  ) : null}

                  {report.analysisStatus === "failed" && (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-[9px] leading-4 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/[0.06] dark:text-amber-300">
                        AI triage unavailable — staff will review this report manually.
                      </p>
                      <button
                        className="rounded border border-cyan/25 bg-cyan/10 px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan transition hover:border-cyan/50 disabled:cursor-wait disabled:opacity-50"
                        disabled={retryingReportId === report.id}
                        onClick={() => handleRetryTriage(report.id)}
                        type="button"
                      >
                        {retryingReportId === report.id
                          ? "Retrying…"
                          : "Retry AI triage"}
                      </button>
                      {triageErrors[report.id] && (
                        <p className="text-xs text-alert" role="alert">{triageErrors[report.id]}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[10px] text-muted">
                    <span>REPORT RECEIVED</span>
                    <span
                      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
                        report.status === "Resolved"
                          ? "bg-resolved/10 text-resolved"
                          : report.status === "In Progress"
                            ? "bg-progress/10 text-progress"
                            : "bg-pending/10 text-pending"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {report.status}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && filteredReports.length === 0 && (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-line bg-panel/70 px-6 py-10 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan/20 bg-cyan/10 text-cyan">
              <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 24 24">
                <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="12" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold text-ink">
              {reportDetails.length === 0
                ? "No incidents yet. Be the first to report."
                : "No incidents match these filters."}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {reportDetails.length === 0
                ? "Help your community spot an issue and get it to the right team."
                : "Try a different search or clear the selected filters."}
            </p>
            {reportDetails.length === 0 ? (
              <button
                className="mt-5 min-h-11 rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] dark:text-slate-900"
                onClick={onCreateReport}
                type="button"
              >
                Report an issue
              </button>
            ) : (
              <button
                className="mt-5 rounded-lg border border-line bg-panel-raised px-4 py-2.5 font-mono text-xs font-semibold text-ink transition hover:bg-panel-hover active:scale-[0.98]"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("All");
                  setUrgencyFilter("All urgencies");
                  setDistrictFilter("All districts");
                }}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && !error && filteredReports.length > 0 && (
        <div className="mt-6 flex flex-col gap-2 border-t border-slate-200 dark:border-white/[0.06] pt-4 font-mono text-[9px] uppercase tracking-wide text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Showing {filteredReports.length} of {reportDetails.length} reports</span>
          <span className="inline-flex items-center gap-2 text-mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {lastSynced ? `Updated ${lastSynced.toLocaleTimeString()}` : "Waiting for sync"}
          </span>
        </div>
      )}
    </section>
  );
}
