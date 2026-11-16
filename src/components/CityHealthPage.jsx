import { useEffect, useMemo, useState } from "react";
import { IncidentMap } from "./IncidentMap.jsx";
import { getCityHealthMetrics } from "../services/api.js";
import cityConfig from "../../config/city.json";

/* ─── KPI card (screen) ───────────────────────────────────────── */
function Metric({ label, value, detail, accent = "brand" }) {
  const accentStyle = {
    brand: "border-brand/25 bg-brand/10 text-brand",
    pending: "border-pending/25 bg-pending/10 text-pending",
    resolved: "border-resolved/25 bg-resolved/10 text-resolved",
    progress: "border-progress/25 bg-progress/10 text-progress",
  }[accent] ?? "border-line text-brand";

  return (
    <article className="group rounded-xl border border-line bg-panel p-5 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md dark:shadow-lg">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ${accentStyle}`}>
          Live
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold tracking-tight text-ink group-hover:text-brand transition-colors">{value}</p>
      {detail ? <p className="mt-1 font-mono text-xs text-muted">{detail}</p> : null}
    </article>
  );
}

/* ─── Printer SVG icon ───────────────────────────────────────── */
function PrinterIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={16}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={16}
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect height="8" width="12" x="6" y="14" />
    </svg>
  );
}

/* ─── Inline progress bar (print-safe, no Tailwind needed) ──── */
function Bar({ pct }) {
  return (
    <div
      style={{
        width: "100%",
        height: "6px",
        background: "#e5e7eb",
        borderRadius: "3px",
        overflow: "hidden",
        marginTop: "3px",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "#16a34a",
          borderRadius: "3px",
        }}
      />
    </div>
  );
}

/* ─── Executive brief (hidden on screen, visible on print) ──── */
function ExecBrief({ metrics, generatedAt }) {
  const { cityName } = cityConfig;
  const avgTime =
    metrics.averageHoursToResolve === null
      ? "—"
      : metrics.averageHoursToResolve < 1
        ? "<1 hr"
        : `${metrics.averageHoursToResolve} hrs`;

  return (
    /* sr-only on screen; @media print overrides visibility via .civic-exec-brief */
    <div
      aria-hidden="true"
      className="civic-exec-brief"
      style={{
        /* hidden on-screen but takes no space */
        position: "fixed",
        left: "-9999px",
        top: 0,
        width: "210mm",
      }}
    >
      {/* ── Header band ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "2.5px solid #111",
          paddingBottom: "6mm",
          marginBottom: "7mm",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* CivicGuard shield icon */}
            <svg fill="none" height="32" viewBox="0 0 32 32" width="32">
              <path
                d="M16 2L4 7v9c0 7.18 5.16 13.9 12 15.93C23.84 29.9 29 23.18 29 16V7L16 2z"
                fill="#16a34a"
                opacity="0.15"
              />
              <path
                d="M16 2L4 7v9c0 7.18 5.16 13.9 12 15.93C23.84 29.9 29 23.18 29 16V7L16 2z"
                stroke="#16a34a"
                strokeWidth="2"
              />
              <path
                d="M11 16l3 3 7-7"
                stroke="#16a34a"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
              />
            </svg>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#111" }}>CivicGuard</span>
          </div>
          <div style={{ marginTop: "4px", fontSize: "11px", color: "#555" }}>
            Municipal Intelligence Platform
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#111" }}>
            {cityName} — City Health Brief
          </div>
          <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>
            Generated: {generatedAt}
          </div>
        </div>
      </div>

      {/* ── Section title ───────────────────────────────────── */}
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#16a34a",
          marginBottom: "5mm",
        }}
      >
        Executive KPI Summary
      </div>

      {/* ── 4-column KPI row ────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "4mm",
          marginBottom: "7mm",
        }}
      >
        {[
          { label: "Total Reports", value: metrics.totalReports.toLocaleString() },
          { label: "Open Reports", value: metrics.openReports.toLocaleString() },
          { label: "Resolved Reports", value: metrics.resolvedReports.toLocaleString() },
          { label: "Avg Time to Resolve", value: avgTime },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "4mm 5mm",
              background: "#f9fafb",
            }}
          >
            <div style={{ fontSize: "9px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280" }}>
              {label}
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#111", marginTop: "2mm" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Overall resolution rate ─────────────────────────── */}
      <div
        style={{
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          padding: "5mm 6mm",
          marginBottom: "7mm",
          background: "#f0fdf4",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "3mm",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#15803d" }}>
            Overall Resolution Rate
          </span>
          <span style={{ fontSize: "26px", fontWeight: 800, color: "#15803d" }}>
            {metrics.resolutionRate}%
          </span>
        </div>
        <Bar pct={metrics.resolutionRate} />
      </div>

      {/* ── Resolution by category ──────────────────────────── */}
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#16a34a",
          marginBottom: "4mm",
        }}
      >
        Resolution by Category
      </div>

      {metrics.resolutionRateByCategory.length > 0 ? (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "11px",
          }}
        >
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              {["Category", "Total", "Resolved", "Rate", "Progress"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "3mm 3mm",
                    textAlign: h === "Category" || h === "Progress" ? "left" : "right",
                    fontWeight: 700,
                    borderBottom: "1.5px solid #d1d5db",
                    color: "#374151",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.resolutionRateByCategory.map((cat, idx) => (
              <tr
                key={cat.category}
                style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
              >
                <td style={{ padding: "2.5mm 3mm", fontWeight: 600, color: "#111", borderBottom: "1px solid #e5e7eb" }}>
                  {cat.category}
                </td>
                <td style={{ padding: "2.5mm 3mm", textAlign: "right", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>
                  {cat.totalReports.toLocaleString()}
                </td>
                <td style={{ padding: "2.5mm 3mm", textAlign: "right", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>
                  {cat.resolvedReports.toLocaleString()}
                </td>
                <td style={{ padding: "2.5mm 3mm", textAlign: "right", fontWeight: 700, color: "#15803d", borderBottom: "1px solid #e5e7eb" }}>
                  {cat.resolutionRate}%
                </td>
                <td style={{ padding: "2.5mm 3mm", minWidth: "35mm", borderBottom: "1px solid #e5e7eb" }}>
                  <Bar pct={cat.resolutionRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: "11px", color: "#6b7280" }}>
          No category data available yet.
        </p>
      )}

      {/* ── SLA / compliance note ───────────────────────────── */}
      <div
        style={{
          marginTop: "7mm",
          padding: "4mm 5mm",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "6px",
          fontSize: "10px",
          color: "#92400e",
        }}
      >
        <strong>SLA Note:</strong> Resolution rate reflects reports marked &ldquo;resolved&rdquo; at time of export.
        Target SLA is 48 hrs for critical incidents and 7 days for standard reports.
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <div
        style={{
          marginTop: "9mm",
          paddingTop: "4mm",
          borderTop: "1px solid #d1d5db",
          fontSize: "9px",
          color: "#9ca3af",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Generated by CivicGuard Municipal Intelligence Platform &middot; {generatedAt}
        </span>
        <span>
          Aggregate statistics only &mdash; no personal data included
        </span>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function CityHealthPage() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const generatedAt = useMemo(
    () =>
      new Date().toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    getCityHealthMetrics()
      .then((result) => {
        if (active) {
          setMetrics(result);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "City Health data could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const mapReports = useMemo(
    () =>
      (metrics?.mapCells ?? []).map((cell, index) => ({
        id: `aggregate-cell-${index}`,
        lat: cell.lat,
        lng: cell.lng,
        title: "Reported issues",
        category: "All categories",
        reportCount: cell.count,
        urgency: "medium",
      })),
    [metrics],
  );

  if (error) {
    return (
      <section className="mx-auto max-w-3xl rounded-xl border border-line bg-panel p-6 sm:p-8" role="alert">
        <h1 className="font-display text-2xl font-semibold text-ink">City Health is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{error}</p>
        <button
          className="mt-5 min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onClick={() => setRetry((count) => count + 1)}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!metrics) {
    return (
      <section aria-busy="true" aria-label="Loading City Health data" className="mx-auto max-w-7xl">
        <div className="civic-skeleton h-8 w-64 rounded-lg" />
        <div className="mt-3 civic-skeleton h-5 w-full max-w-xl rounded-lg" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="civic-skeleton h-32 rounded-xl" key={index} />
          ))}
        </div>
        <div className="mt-6 civic-skeleton h-[360px] rounded-xl" />
      </section>
    );
  }

  return (
    <>
      {/* ── Screen content (hidden during print) ───────────── */}
      <main className="civic-exec-brief-screen-only mx-auto max-w-7xl space-y-8">
        <header>
          <p className="text-sm font-semibold text-brand">Public service overview</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {cityConfig.cityName} City Health
            </h1>
            {/* ── 1-Click PDF Export button ─────────────────── */}
            <button
              aria-label="Export City Health executive brief as PDF"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:border-brand/40 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand"
              onClick={() => window.print()}
              type="button"
            >
              <PrinterIcon />
              Export PDF Brief
            </button>
          </div>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            A citywide view of reported issues and resolution progress across {cityConfig.cityName}. This page
            shows aggregate statistics only; individual reports and personal details are not shown.
          </p>
        </header>

        <section aria-label="Citywide report metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total reports" value={metrics.totalReports.toLocaleString()} />
          <Metric label="Open reports" value={metrics.openReports.toLocaleString()} />
          <Metric label="Resolved reports" value={metrics.resolvedReports.toLocaleString()} />
          <Metric
            detail={metrics.averageHoursToResolve === null ? "No resolved reports yet" : "Average elapsed time"}
            label="Average time to resolve"
            value={
              metrics.averageHoursToResolve === null
                ? "—"
                : metrics.averageHoursToResolve < 1
                  ? "<1 hr"
                  : `${metrics.averageHoursToResolve} hrs`
            }
          />
        </section>

        <section aria-labelledby="city-health-map-title" className="rounded-xl border border-line bg-panel p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold text-ink" id="city-health-map-title">
              Report activity over the last 30 days
            </h2>
            <p className="mt-1 text-sm text-muted">
              Markers are grouped into approximate 1 km cells. Counts represent reports, not people.
            </p>
          </div>
          {mapReports.length ? (
            <IncidentMap height={400} reports={mapReports} />
          ) : (
            <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-line bg-panel-hover p-6 text-center">
              <p className="max-w-md text-sm leading-6 text-muted">
                No location data is available for the past 30 days yet.
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="city-health-categories-title" className="rounded-xl border border-line bg-panel p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink" id="city-health-categories-title">
                Resolution by category
              </h2>
              <p className="mt-1 text-sm text-muted">Share of reports marked resolved in each category.</p>
            </div>
            <p className="text-sm font-medium text-brand">Overall resolution rate: {metrics.resolutionRate}%</p>
          </div>
          {metrics.resolutionRateByCategory.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="px-3 py-3 font-semibold" scope="col">Category</th>
                    <th className="px-3 py-3 text-right font-semibold" scope="col">Reports</th>
                    <th className="px-3 py-3 text-right font-semibold" scope="col">Resolved</th>
                    <th className="px-3 py-3 text-right font-semibold" scope="col">Resolution rate</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.resolutionRateByCategory.map((category) => (
                    <tr className="border-b border-line last:border-0" key={category.category}>
                      <th className="px-3 py-3 font-medium text-ink" scope="row">{category.category}</th>
                      <td className="px-3 py-3 text-right text-muted">{category.totalReports.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-muted">{category.resolvedReports.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right font-semibold text-ink">{category.resolutionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg bg-panel-hover p-4 text-sm text-muted">Category statistics will appear when reports are submitted.</p>
          )}
        </section>
      </main>

      {/* ── Print-only executive brief (positioned off-screen on screen) ── */}
      <ExecBrief generatedAt={generatedAt} metrics={metrics} />
    </>
  );
}
