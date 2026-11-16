import { useEffect, useState } from "react";
import { getTrackedReport } from "../services/api.js";
import ReportConfirmationButton from "./ReportConfirmationButton.jsx";

const milestones = ["Received", "Triaged", "In Progress", "Resolved"];

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ReportTrackingPage({ code }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getTrackedReport(code)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "This tracking code could not be found.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [code]);

  const reachedStatuses = new Set((report?.timeline ?? []).map((event) => event.status));
  const currentStatus = report?.status;
  const reached = new Set(milestones.slice(0, Math.max(0, milestones.indexOf(currentStatus) + 1)));

  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-line bg-panel p-6 shadow sm:p-8">
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand" href="/">
        ← Back to CivicGuard
      </a>
      <p className="mt-7 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
        Anonymous report tracking
      </p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Report status</h1>
      <p className="mt-2 text-sm text-muted">
        Tracking code <strong className="font-mono text-ink">{code}</strong>
      </p>

      {loading ? (
        <p className="mt-8 civic-skeleton h-12 rounded-lg p-4 text-sm text-muted" role="status">Loading status…</p>
      ) : error ? (
        <p className="mt-8 rounded-lg border border-signal/25 bg-signal/5 p-4 text-sm text-signal" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="mt-8 rounded-xl border border-line bg-deep/40 p-5">
            <p className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
              Resolution Pipeline
            </p>
            <div className="relative flex items-center justify-between">
              <div className="absolute left-0 top-1/2 -z-0 h-1 w-full -translate-y-1/2 bg-line" />
              {milestones.map((status, idx) => {
                const complete = reached.has(status) || reachedStatuses.has(status);
                const isCurrent = currentStatus === status;
                return (
                  <div key={status} className="relative z-10 flex flex-col items-center">
                    <div
                      className={`grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-bold transition ${
                        complete
                          ? "border-resolved bg-resolved text-white shadow-sm"
                          : isCurrent
                            ? "border-brand bg-panel text-brand ring-4 ring-brand/20 animate-pulse"
                            : "border-line bg-panel text-muted"
                      }`}
                    >
                      {complete ? "✓" : idx + 1}
                    </div>
                    <span className={`mt-2 font-mono text-[10px] ${isCurrent ? "font-bold text-brand" : complete ? "text-ink" : "text-muted"}`}>
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <ol aria-label="Report status timeline" className="mt-6 space-y-4">
            {milestones.map((status) => {
              const event = [...report.timeline].reverse().find((item) => item.status === status);
              const complete = reached.has(status) || reachedStatuses.has(status);
              return (
                <li className="flex gap-3 rounded-lg border border-line/60 bg-panel-raised/50 p-3.5" key={status}>
                  <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${complete ? "bg-resolved" : "bg-line text-muted"}`}>
                    {complete ? "✓" : "○"}
                  </span>
                  <div>
                    <p className={`text-sm font-semibold ${complete ? "text-ink" : "text-muted"}`}>{status}</p>
                    {event ? <p className="mt-0.5 font-mono text-xs text-muted">{formatTime(event.createdAt)}</p> : null}
                    {event?.note ? <p className="mt-1 text-sm text-muted">{event.note}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <p aria-live="polite" className="mt-8 rounded-lg border border-line bg-deep p-4 text-sm text-ink">
            Current status: <strong>{report.status}</strong>
          </p>
          {report.status === "Resolved" && (report.image?.url || report.afterPhoto?.url) ? (
            <section aria-label="Before and after resolution photos" className="mt-6">
              <h2 className="font-display text-lg font-semibold text-ink">Resolution proof</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {report.image?.url ? (
                  <figure>
                    <img alt="Before work began" className="aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" src={report.image.url} />
                    <figcaption className="mt-2 text-sm font-medium text-muted">Before</figcaption>
                  </figure>
                ) : null}
                {report.afterPhoto?.url ? (
                  <figure>
                    <img alt="After the issue was resolved" className="aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" src={report.afterPhoto.url} />
                    <figcaption className="mt-2 text-sm font-medium text-muted">After</figcaption>
                  </figure>
                ) : null}
              </div>
              {report.afterNote ? <p className="mt-4 rounded-lg border border-line bg-deep p-4 text-sm leading-6 text-ink">{report.afterNote}</p> : null}
            </section>
          ) : null}
          <div className="mt-5">
            <ReportConfirmationButton
              confirmationCount={report.confirmationCount}
              onConfirmed={(result) => setReport((current) => ({
                ...current,
                reportCount: result.reportCount ?? current.reportCount,
                confirmationCount: result.confirmationCount ?? current.confirmationCount,
              }))}
              reportId={report.reportId}
            />
          </div>
        </>
      )}
    </section>
  );
}
