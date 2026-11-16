import { useEffect, useRef, useState } from "react";
import { createReport } from "../services/api.js";
import { saveOfflineReport } from "../services/offlineQueue.js";
import { optimizeImageForUpload } from "../services/imageOptimizer.js";
import { LocationPicker } from "./IncidentMap.jsx";
import { reportFormLabels } from "../i18n/reportForm.js";
import cityConfig from "../../config/city.json";

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const CATEGORY_ICONS = {
  Pothole: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19h16M4 15c2-1 4-2 6-1s4 3 6 1 4-2 4-2M4 11c3 0 5-2 8-2s6 2 8 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Streetlight: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Accessibility: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="5" r="2" />
      <path d="m9 20 3-6-3-4h6l-1 4 4 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 12h12" strokeLinecap="round" />
    </svg>
  ),
  Garbage: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Other: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function getReportLocationPreset() {
  const query = new URLSearchParams(window.location.search);
  const lat = Number(query.get("lat"));
  const lng = Number(query.get("lng"));
  if (!query.has("lat") || !query.has("lng") ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

export default function ReportForm({ onOptimisticSubmit, onSubmit }) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [descriptionLength, setDescriptionLength] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const imageInputRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [location, setLocation] = useState(getReportLocationPreset);
  const [placeName] = useState(() => {
    const place = new URLSearchParams(window.location.search).get("place");
    return place?.trim().slice(0, 100) ?? "";
  });
  const [language, setLanguage] = useState("en");
  const [trackingCode, setTrackingCode] = useState("");
  const [duplicateReportId, setDuplicateReportId] = useState(null);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const labels = reportFormLabels[language];

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);

  async function handleSubmit(event) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const imageInput = formElement.elements.namedItem("image");
    const selectedImage = imageInput?.files?.[0];
    if (selectedImage && !selectedImage.type.startsWith("image/")) {
      setSubmitError("Choose an image file to attach.");
      return;
    }
    if (selectedImage && selectedImage.size > MAX_IMAGE_SIZE_BYTES) {
      setSubmitError("Choose an image smaller than 10 MB.");
      return;
    }
    if (formData.get("category") !== "Other") formData.delete("customCategory");
    if (location) {
      formData.set("latitude", location.lat.toFixed(6));
      formData.set("longitude", location.lng.toFixed(6));
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);
    setOfflineSaved(false);
    setTrackingCode("");
    setDuplicateReportId(null);

    let optimisticId = null;
    try {
      const description = String(formData.get("description") ?? "").trim();
      const selected = String(formData.get("category") ?? "");
      const category = selected === "Other"
        ? String(formData.get("customCategory") ?? "").trim()
        : selected;
      optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimisticReport = {
        id: optimisticId,
        timestamp: new Date().toISOString(),
        title: String(formData.get("title") ?? "").trim(),
        category,
        description,
        analysis: null,
        analysisStatus: "pending",
        status: "Pending",
        district: String(formData.get("district") ?? "").trim() || "Unassigned",
        location: location ? { lat: location.lat, lng: location.lng } : null,
        image: imagePreviewUrl || null,
      };
      onOptimisticSubmit?.(optimisticReport);

      if (imageInput?.files?.length) {
        const optimizedImage = await optimizeImageForUpload(imageInput.files[0]);
        formData.delete("image");
        formData.set("image", optimizedImage, optimizedImage.name);
      } else {
        formData.delete("image");
      }

      const report = await createReport(formData);
      setTrackingCode(report.trackingCode ?? "");
      setDuplicateReportId(report.duplicate?.id ?? null);
      formElement.reset();
      setSelectedCategory("");
      setDescriptionLength(0);
      setLocation(null);
      setImageFile(null);
      setSubmitSuccess(true);
      onSubmit?.(report, optimisticId);
    } catch (error) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          await saveOfflineReport({
            title: String(formData.get("title") ?? "").trim(),
            category: selectedCategory === "Other" ? String(formData.get("customCategory") ?? "").trim() : selectedCategory,
            customCategory: formData.get("customCategory"),
            district: String(formData.get("district") ?? "").trim(),
            description: String(formData.get("description") ?? "").trim(),
            latitude: location ? location.lat.toFixed(6) : null,
            longitude: location ? location.lng.toFixed(6) : null,
            imageBlob: imageFile,
            imageName: imageFile?.name,
          });
          formElement.reset();
          setSelectedCategory("");
          setDescriptionLength(0);
          setLocation(null);
          setImageFile(null);
          setOfflineSaved(true);
          onSubmit?.(null, optimisticId);
          return;
        } catch {
          // Fall through to standard error display
        }
      }
      if (optimisticId) onSubmit?.(null, optimisticId, error.message);
      setSubmitError(error.message || "The report could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-panel shadow">
      <div className="px-6 pb-6 pt-7 sm:px-8 sm:pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
              {labels.intake}
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {labels.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">{labels.intro}</p>
            {placeName ? (
              <p className="mt-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-sm font-medium text-brand">
                Reporting location: {placeName}
              </p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-muted">
            {labels.language}
            <select
              aria-label={labels.language}
              className="rounded border border-slate-200 bg-white px-2 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              onChange={(event) => setLanguage(event.target.value)}
              value={language}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="kn">ಕನ್ನಡ</option>
            </select>
          </label>
        </div>
        <p className="mt-4 rounded-lg border border-pending/25 bg-pending/5 px-3 py-3 text-xs leading-5 text-pending">
          {labels.emergency}
        </p>
      </div>

      <form
        className="space-y-6 border-t border-line px-5 py-6 sm:px-8"
        onSubmit={handleSubmit}
      >
        <div
          aria-hidden="true"
          className="absolute -left-[10000px] h-px w-px overflow-hidden"
        >
          <label htmlFor="report-website">Leave this field empty</label>
          <input
            autoComplete="off"
            id="report-website"
            name="website"
            tabIndex={-1}
            type="text"
          />
        </div>
        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-title"
          >
            {labels.reportTitle}
          </label>
          <input
            className="block min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
            id="report-title"
            maxLength={120}
            name="title"
            placeholder="e.g. Pothole on Oak Street"
            required
            type="text"
          />
        </div>

        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-category"
          >
            {labels.category}
          </label>
          <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[...cityConfig.categories, "Other"].map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all duration-150 ${
                    isSelected
                      ? "border-brand bg-brand/10 text-brand shadow-sm ring-2 ring-brand/30"
                      : "border-line bg-panel-raised text-muted hover:border-brand/40 hover:bg-panel-hover hover:text-ink"
                  }`}
                >
                  <span className={isSelected ? "text-brand" : "text-muted"}>
                    {CATEGORY_ICONS[cat] ?? CATEGORY_ICONS.Other}
                  </span>
                  <span className="font-mono text-xs font-semibold leading-tight">{cat}</span>
                </button>
              );
            })}
          </div>
          <select
            className="block min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            id="report-category"
            name="category"
            onChange={(event) => setSelectedCategory(event.target.value)}
            required
            value={selectedCategory}
          >
            <option className="bg-panel" disabled value="">
              {labels.chooseCategory}
            </option>
            {cityConfig.categories.map((category) => (
              <option className="bg-panel" key={category} value={category}>{category}</option>
            ))}
            <option className="bg-panel" value="Other">Other</option>
          </select>
        </div>

        {selectedCategory === "Other" && (
          <div>
            <label
              className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
              htmlFor="report-custom-category"
            >
              {labels.describeCategory}
            </label>
            <input
              autoComplete="off"
              className="block min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
              id="report-custom-category"
              maxLength={80}
              minLength={2}
              name="customCategory"
              placeholder="e.g. Water leak, damaged sign, or fallen tree"
              required
              type="text"
            />
            <p className="mt-2 font-mono text-[9px] text-muted/70">
              Enter a short name for the issue category.
            </p>
          </div>
        )}

        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-district"
          >
            {labels.district}
          </label>
          <input
            className="block min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
            id="report-district"
            maxLength={100}
            name="district"
            placeholder="e.g. North District / Ward 3"
            defaultValue={placeName}
            type="text"
          />
        </div>

        <LocationPicker language={language} onChange={setLocation} value={location} />

        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-description"
          >
            {labels.description}
          </label>
          <textarea
            className="block min-h-32 w-full resize-y rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
            id="report-description"
            maxLength={MAX_DESCRIPTION_LENGTH}
            name="description"
            onChange={(event) => setDescriptionLength(event.target.value.length)}
            placeholder="Describe the issue and where it is located..."
            required
            rows={5}
          />
          <p className="mt-1.5 text-right font-mono text-[9px] text-muted/70">
            {descriptionLength.toLocaleString()} / {MAX_DESCRIPTION_LENGTH.toLocaleString()}
          </p>
        </div>

        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-photo"
          >
            {labels.photo} <span className="font-normal normal-case tracking-normal text-muted/70">({labels.optional})</span>
          </label>
          <div
            className="group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-panel-raised p-6 text-center transition hover:border-brand/50 hover:bg-panel-hover"
            onClick={() => imageInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file && imageInputRef.current) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                imageInputRef.current.files = dataTransfer.files;
                imageInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }}
          >
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-brand/10 text-brand">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-ink group-hover:text-brand">
              Click to upload photo <span className="font-normal text-muted">or drag & drop</span>
            </p>
            <p className="mt-1 font-mono text-[9px] text-muted">
              JPEG, PNG, or WebP up to 10 MB (EXIF metadata stripped automatically)
            </p>
            <input
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              id="report-photo"
              name="image"
              ref={imageInputRef}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (!file) {
                  setImageFile(null);
                  return;
                }
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                  event.target.value = "";
                  setImageFile(null);
                  setSubmitError("Choose a JPEG, PNG, or WebP image.");
                  return;
                }
                if (file.size > MAX_IMAGE_SIZE_BYTES) {
                  event.target.value = "";
                  setImageFile(null);
                  setSubmitError("Choose an image smaller than 10 MB.");
                  return;
                }
                setSubmitError("");
                setImageFile(file);
              }}
              type="file"
            />
          </div>
          {imagePreviewUrl && imageFile && (
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-line bg-panel p-3">
              <img
                alt={`Preview of ${imageFile.name}`}
                className="h-20 w-20 rounded-lg object-cover"
                height="80"
                loading="lazy"
                src={imagePreviewUrl}
                width="80"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">
                  {imageFile.name}
                </p>
                <p className="mt-1 font-mono text-[9px] text-muted">
                  {(imageFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <button
                aria-label="Remove selected image"
                className="rounded px-2 py-1 text-xs text-muted hover:bg-panel-hover hover:text-ink"
                onClick={() => {
                  if (imageInputRef.current) imageInputRef.current.value = "";
                  setImageFile(null);
                }}
                type="button"
              >
                {labels.remove}
              </button>
            </div>
          )}
        </div>

        {offlineSaved && (
          <div
            aria-live="polite"
            className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300 p-4 text-sm text-amber-900"
            role="status"
          >
            <div className="flex items-center gap-2 font-semibold">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.121-4.243m0 0L1 21m2-2.828l2.829-2.829" />
              </svg>
              <span>Saved offline on your device</span>
            </div>
            <p className="mt-1 text-xs leading-5">
              You are currently offline. CivicGuard has safely stored your report and will automatically dispatch it as soon as your connection returns.
            </p>
          </div>
        )}
        {submitError && (
          <p
            className="rounded-lg border border-signal/25 bg-signal/5 px-4 py-3 text-sm text-signal"
            role="alert"
          >
            {submitError}
          </p>
        )}
        {submitSuccess && (
          <p
            aria-live="polite"
            className="rounded-lg border border-resolved/25 bg-resolved/5 px-4 py-3 text-sm text-resolved"
            role="status"
          >
            {labels.success}
            {duplicateReportId ? (
              <span className="mt-1 block">This report was linked to an existing nearby incident.</span>
            ) : null}
            {trackingCode ? (
              <span className="mt-2 block">
                <a className="font-mono font-semibold underline" href={`/track/${encodeURIComponent(trackingCode)}`}>{labels.trackingCode}: {trackingCode}</a>
              </span>
            ) : null}
          </p>
        )}

        <button
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-cyan px-5 py-3 text-sm font-semibold tracking-wide text-white shadow transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-900 dark:focus:ring-offset-slate-900 sm:w-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? labels.submitting : labels.submit}
        </button>
      </form>
    </section>
  );
}
