import { useEffect, useState } from "react";
import { confirmReport } from "../services/api.js";
import { hasConfirmedReport, markReportConfirmed } from "../services/deviceIdentity.js";

export default function ReportConfirmationButton({
  reportId,
  confirmationCount = 0,
  onConfirmed,
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(Number(confirmationCount) || 0);

  useEffect(() => {
    setConfirmed(hasConfirmedReport(reportId));
  }, [reportId]);

  useEffect(() => {
    setCount(Number(confirmationCount) || 0);
  }, [confirmationCount]);

  async function handleConfirm() {
    if (busy || confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await confirmReport(reportId);
      markReportConfirmed(reportId);
      setConfirmed(true);
      setCount(result.confirmationCount ?? count);
      onConfirmed?.(result);
    } catch (requestError) {
      setError(requestError.message || "Your confirmation could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <p aria-live="polite" className="text-sm font-medium text-ink">
        {count} {count === 1 ? "person" : "people"} confirmed this
      </p>
      <button
        aria-pressed={confirmed}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel-raised px-3 py-2 text-sm font-semibold text-brand transition hover:bg-panel-hover focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
        disabled={confirmed || busy}
        onClick={handleConfirm}
        type="button"
      >
        {busy ? "Saving…" : confirmed ? "You see this too" : "I see this too"}
      </button>
      {error ? <p className="text-xs text-signal" role="alert">{error}</p> : null}
    </div>
  );
}
