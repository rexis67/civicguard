import { useEffect, useMemo, useState } from "react";
import { getReports } from "../services/api.js";

const REFRESH_INTERVAL_MS = 5000;

const urgencyStyles = {
  low: "border-mint/25 bg-mint/10 text-mint",
  medium: "border-yellow-400/25 bg-yellow-400/10 text-yellow-300",
  high: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  critical: "border-alert/30 bg-alert/10 text-alert",
};

const categoryStyles = {
  pothole: "text-alert",
  streetlight: "text-cyan",
  accessibility: "text-mint",
  garbage: "text-yellow-300",
};

const PRIMARY_CATEGORIES = ["Pothole", "Streetlight", "Accessibility", "Garbage"];

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
    report.analysisStatus === "pending" || report.analysisStatus === "failed"
      ? report.analysisStatus
      : "complete";

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
      tags: Array.isArray(analysis.tags) ? analysis.tags.filter((tag) => typeof tag === "string") : [],
      hasImage: Boolean(report.image),
      imageUrl: typeof report.image?.url === "string" ? report.image.url : null,
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
  const activeColor = score >= 5 ? "bg-alert" : score >= 3 ? "bg-cyan" : "bg-mint";

  return (
    <div aria-label={score ? `Severity ${score} out of 5` : "Severity not rated"} role="img">
      <div aria-hidden="true" className="mt-2 grid h-1.5 grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            className={`rounded-full ${
              score !== null && level <= score ? `${activeColor} shadow-[0_0_7px_currentColor]` : "bg-white/10"
            }`}
            key={level}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyIncidentCard({ index }) {
  return (
    <article className="flex min-h-[340px] flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-panel shadow-xl">
      <div className="border-b border-white/[0.04] bg-gradient-to-b from-cyan/[0.05] to-transparent px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[9px] font-semibold tracking-wide text-muted">
            INTAKE SLOT 0{index + 1}
          </span>
          <span className="rounded-full border border-white/10 bg-panel-raised px-2.5 py-1 font-mono text-[9px] uppercase tracking-wide text-muted">
            Awaiting data
          </span>
        </div>
        <h2 className="mt-3 font-display text-lg font-semibold text-ink">
          No incident submitted
        </h2>
        <p className="mt-2 font-mono text-[10px] text-muted/70">
          A new report will appear here
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        <div className="rounded-lg bg-deep/75 p-3">
          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-muted">ISSUE SEVERITY</span>
            <span className="text-muted/70">NOT RATED</span>
          </div>
          <div aria-hidden="true" className="mt-2 grid h-1.5 grid-cols-5 gap-1">
            {Array.from({ length: 5 }, (_, segment) => (
              <span className="rounded-full bg-white/10" key={segment} />
            ))}
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-muted/70">Awaiting analysis</p>
        </div>

        <div className="grid flex-1 place-items-center rounded-lg border border-white/[0.04] bg-deep/50">
          <div className="text-center">
            <span aria-hidden="true" className="font-mono text-2xl text-cyan/40">⌖</span>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-muted/70">
              Incident details will populate on submission
            </p>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3 font-mono text-[9px] text-muted/70">
          <span>REPORT QUEUE</span>
          <span>NO DATA</span>
        </div>
      </div>
    </article>
  );
}

export default function ReportFeed() {
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [urgencyFilter, setUrgencyFilter] = useState("All urgencies");
  const [districtFilter, setDistrictFilter] = useState("All districts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSynced, setLastSynced] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    async function loadReports() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const data = await getReports();
        if (cancelled) return;
        if (!Array.isArray(data)) {
          throw new Error("The reports response was not a list.");
        }

        setReports(data);
        setError("");
        setLastSynced(new Date());
      } catch (fetchError) {
        if (!cancelled) setError(fetchError.message || "Could not load reports.");
      } finally {
        requestInFlight = false;
        if (!cancelled) setLoading(false);
      }
    }

    loadReports();
    const intervalId = window.setInterval(loadReports, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshKey]);

  const reportDetails = useMemo(
    () =>
      [...reports]
        .sort((left, right) => {
          const leftTime = new Date(left.timestamp ?? left.createdAt ?? 0).getTime() || 0;
          const rightTime = new Date(right.timestamp ?? right.createdAt ?? 0).getTime() || 0;
          return rightTime - leftTime;
        })
        .map(getReportDetails),
    [reports],
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
  const districts = useMemo(
    () => ["All districts", ...new Set(reportDetails.map((report) => report.district).filter(Boolean))],
    [reportDetails],
  );

  return (
    <section className="mx-auto w-full max-w-[1720px]">
      <div className="-mx-4 mb-5 border-y border-white/[0.06] bg-panel px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-[1720px] flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span className="relative grid h-3 w-3 place-items-center rounded-full bg-alert/30">
                <span className="absolute h-3 w-3 animate-ping rounded-full bg-alert/50" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-alert" />
              </span>
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
                Live Incident Stream
              </h1>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-panel-hover px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              Active load
              <span className="rounded bg-deep px-2 py-0.5 font-semibold text-cyan">
                {reports.length} reports
              </span>
            </div>
            <p className="hidden items-center gap-2 font-mono text-[10px] text-muted md:flex">
              <span className="text-mint">◆</span> Civic reporting network
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-panel-raised px-3 py-2 font-mono text-[10px] text-ink">
            <span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse bg-cyan" : error ? "bg-alert" : "bg-mint shadow-[0_0_8px_#4edea3]"}`} />
            {loading ? "Connecting to report API" : error ? "Auto-sync paused · API issue" : "Auto-sync · 5 sec"}
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <span className="sr-only">Search by keyword, incident ID, or category</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">⌕</span>
            <input
              className="w-full rounded-xl border border-white/[0.06] bg-deep py-2.5 pl-10 pr-4 text-sm text-ink shadow-inner outline-none placeholder:text-muted/60 focus:border-cyan/60 focus:ring-2 focus:ring-cyan/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by keyword, incident ID, or category..."
              type="search"
              value={search}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs text-muted">
              <span className="text-cyan">!</span>
              <span>Urgency:</span>
              <select
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

        <div aria-label="Filter reports by category" className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((category) => {
            const count =
              category === "All"
                ? reports.length
                : reportDetails.filter(
                    (report) => report.category.toLowerCase() === category.toLowerCase(),
                  ).length;
            const isSelected = categoryFilter === category;

            return (
              <button
                aria-pressed={isSelected}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[10px] transition ${
                  isSelected
                    ? "bg-cyan font-semibold text-[#06202a] shadow-[0_0_12px_rgba(6,182,212,0.25)]"
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

      {loading ? (
        <p aria-live="polite" className="rounded-xl border border-white/[0.06] bg-panel p-6 text-muted">
          Loading incident stream…
        </p>
      ) : error ? (
        <div className="flex flex-col gap-3 rounded-xl border border-alert/20 bg-alert/10 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="text-sm text-alert" role="alert">
            {error} Automatic refresh will retry shortly.
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
      ) : (
        <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${reportGridColumns}`}>
          {filteredReports.map((report, index) => {
            const categoryStyle =
              categoryStyles[report.category.toLowerCase()] ??
              "text-cyan";
            const urgencyStyle = urgencyStyles[report.urgency] ?? urgencyStyles.medium;

            return (
              <article
                className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-panel shadow-xl transition duration-300 hover:bg-panel-hover ${
                  report.urgency === "critical"
                    ? "border-alert/20"
                    : "border-white/[0.06]"
                }`}
                key={report.id ?? `${report.title}-${report.timestamp}-${index}`}
              >
                <div className={`border-b border-white/[0.04] bg-gradient-to-b px-5 pb-4 pt-5 ${report.urgency === "critical" ? "from-alert/10" : "from-cyan/[0.06]"} to-transparent`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-mono text-[9px] text-muted">
                      <span className="font-semibold tracking-wide text-cyan">
                        #{report.id ? report.id.slice(0, 8).toUpperCase() : "NEW"}
                      </span>
                      <span className="text-white/20">•</span>
                      <time>{report.timestamp}</time>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide ${
                        report.analysisStatus === "pending"
                          ? "border-cyan/25 bg-cyan/10 text-cyan"
                          : report.analysisStatus === "failed"
                            ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
                            : urgencyStyle
                      } ${report.urgency === "critical" && report.analysisStatus === "complete" ? "animate-pulse" : ""}`}
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
                  <h2 className="mt-3 font-display text-lg font-semibold leading-snug text-ink transition-colors group-hover:text-cyan">
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
                </div>

                <div className="flex flex-1 flex-col gap-4 px-5 py-4">
                  <div className="rounded-lg bg-deep/75 p-3">
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
                          className="rounded border border-white/[0.06] bg-panel-raised px-2 py-1 font-mono text-[9px] text-muted"
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
                      className="h-36 w-full rounded-lg border border-white/[0.06] object-cover"
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
                    <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 font-mono text-[9px] leading-4 text-amber-300">
                      AI triage unavailable — staff will review this report manually.
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3 font-mono text-[9px] text-muted">
                    <span>REPORT RECEIVED</span>
                    <span
                      className={`inline-flex items-center gap-1.5 ${
                        report.analysisStatus === "pending"
                          ? "text-cyan"
                          : report.analysisStatus === "failed"
                            ? "text-amber-300"
                            : "text-mint"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {report.analysisStatus === "pending"
                        ? "TRIAGE RUNNING"
                        : report.analysisStatus === "failed"
                          ? "AWAITING REVIEW"
                          : report.status === "Resolved"
                            ? "RESOLVED"
                            : report.status === "In Progress"
                              ? "IN PROGRESS"
                              : report.urgency === "critical"
                                ? "PRIORITY REVIEW"
                                : "IN QUEUE"}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && filteredReports.length === 0 && (
        <div className="mb-5 flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-panel/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink">
            {search || categoryFilter !== "All" || urgencyFilter !== "All urgencies"
              ? "No reports match these filters"
              : "No reports have been submitted yet"}
          </p>
          <p className="font-mono text-[9px] text-muted">
            {search || categoryFilter !== "All" || urgencyFilter !== "All urgencies"
              ? "Adjust search or filters to view results"
              : "Incident cards will populate as reports arrive"}
          </p>
        </div>
      )}

      {!loading && filteredReports.length === 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((slot) => (
            <EmptyIncidentCard index={slot} key={slot} />
          ))}
        </div>
      )}

      {!loading && !error && filteredReports.length > 0 && (
        <div className="mt-6 flex flex-col gap-2 border-t border-white/[0.06] pt-4 font-mono text-[9px] uppercase tracking-wide text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Showing {filteredReports.length} of {reports.length} reports</span>
          <span className="inline-flex items-center gap-2 text-mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {lastSynced ? `Updated ${lastSynced.toLocaleTimeString()}` : "Waiting for sync"}
          </span>
        </div>
      )}
    </section>
  );
}
