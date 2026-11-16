import { useState } from "react";
import QRCode from "qrcode";
import { LocationPicker } from "./IncidentMap.jsx";

export default function StaffPostersPage() {
  const [locationName, setLocationName] = useState("");
  const [location, setLocation] = useState(null);
  const [poster, setPoster] = useState(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  async function generatePoster(event) {
    event.preventDefault();
    const name = locationName.trim();
    if (name.length < 2 || name.length > 100) {
      setError("Enter a location name between 2 and 100 characters.");
      return;
    }
    if (!location) {
      setError("Choose a point on the map for this poster.");
      return;
    }

    setGenerating(true);
    setError("");
    try {
      const reportUrl = new URL("/report", window.location.origin);
      reportUrl.searchParams.set("lat", location.lat.toFixed(6));
      reportUrl.searchParams.set("lng", location.lng.toFixed(6));
      reportUrl.searchParams.set("place", name);
      const qrDataUrl = await QRCode.toDataURL(reportUrl.toString(), {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 520,
      });
      setPoster({ name, qrDataUrl, reportUrl: reportUrl.toString() });
    } catch (generationError) {
      console.error("Could not generate the location poster QR code:", generationError);
      setError("The poster could not be generated. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">Staff tools</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          Location reporting posters
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Create a printable poster that opens the report form with this location pinned.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <form className="space-y-5 rounded-xl border border-line bg-panel p-5 sm:p-6" onSubmit={generatePoster}>
          <label className="block text-sm font-medium text-ink" htmlFor="poster-location-name">
            Location name
            <input
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              id="poster-location-name"
              maxLength={100}
              onChange={(event) => setLocationName(event.target.value)}
              placeholder="e.g. Central Library entrance"
              required
              value={locationName}
            />
          </label>
          <LocationPicker height={280} onChange={setLocation} value={location} />
          {error ? <p className="text-sm font-medium text-signal" role="alert">{error}</p> : null}
          <button
            className="min-h-11 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60"
            disabled={generating}
            type="submit"
          >
            {generating ? "Generating poster…" : "Generate poster"}
          </button>
        </form>

        {poster ? (
          <section aria-label="Generated printable poster" className="space-y-4">
            <article className="civic-poster rounded-xl border border-line bg-white p-8 text-center text-slate-900 shadow-sm sm:p-12">
              <p className="text-sm font-semibold uppercase tracking-wide text-brand">CivicGuard</p>
              <h2 className="mt-6 font-display text-3xl font-semibold leading-tight sm:text-4xl">
                Scan to report an issue here
              </h2>
              <img
                alt={`QR code to report an issue at ${poster.name}`}
                className="mx-auto mt-8 aspect-square w-full max-w-[340px]"
                height="520"
                src={poster.qrDataUrl}
                width="520"
              />
              <p className="mt-7 text-xl font-semibold">{poster.name}</p>
              <p className="mt-2 text-sm text-slate-600">No account needed · Track your report to resolution</p>
            </article>
            <div className="flex flex-wrap gap-3 print:hidden">
              <button
                className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                onClick={() => window.print()}
                type="button"
              >
                Print A4 poster
              </button>
              <a
                className="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                href={poster.reportUrl}
                rel="noreferrer"
                target="_blank"
              >
                Preview report form
              </a>
            </div>
          </section>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-line bg-panel p-6 text-center">
            <p className="max-w-sm text-sm leading-6 text-muted">
              Enter a location and select its map point to preview the poster.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
