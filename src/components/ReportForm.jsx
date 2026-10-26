import { useState } from "react";
import { createReport } from "../services/api.js";
import { optimizeImageForUpload } from "../services/imageOptimizer.js";
import { LocationPicker } from "./IncidentMap.jsx";

const MAX_DESCRIPTION_LENGTH = 4000;

export default function ReportForm({ onSubmit }) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [descriptionLength, setDescriptionLength] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [location, setLocation] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const imageInput = formElement.elements.namedItem("image");
    if (formData.get("category") !== "Other") formData.delete("customCategory");
    if (location) {
      formData.set("latitude", location.lat.toFixed(6));
      formData.set("longitude", location.lng.toFixed(6));
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);

    try {
      if (imageInput?.files?.length) {
        const optimizedImage = await optimizeImageForUpload(imageInput.files[0]);
        formData.delete("image");
        formData.set("image", optimizedImage, optimizedImage.name);
      } else {
        formData.delete("image");
      }

      const report = await createReport(formData);
      formElement.reset();
      setSelectedCategory("");
      setDescriptionLength(0);
      setLocation(null);
      setSubmitSuccess(true);
      onSubmit?.(report);
    } catch (error) {
      setSubmitError(error.message || "The report could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-white/[0.07] bg-panel shadow-2xl shadow-black/20">
      <div className="px-6 pb-6 pt-7 sm:px-8 sm:pt-8">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan">
          Citizen intake / new incident
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Report an issue
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Share the details so your community can work toward a solution.
        </p>
        <p className="mt-3 rounded border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 font-mono text-[10px] leading-4 text-amber-300">
          For emergencies or immediate danger, call your local emergency number.
          CivicGuard is for non-urgent municipal issues.
        </p>
      </div>

      <form
        className="space-y-5 border-t border-white/[0.06] px-6 py-6 sm:px-8"
        onSubmit={handleSubmit}
      >
        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-title"
          >
            Title
          </label>
          <input
            className="block w-full rounded border border-white/10 bg-deep/70 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
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
            Category
          </label>
          <select
            className="block w-full rounded border border-white/10 bg-deep/70 px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-cyan focus:ring-2 focus:ring-cyan/20"
            id="report-category"
            name="category"
            onChange={(event) => setSelectedCategory(event.target.value)}
            required
            value={selectedCategory}
          >
            <option className="bg-panel" disabled value="">
              Select a category
            </option>
            <option className="bg-panel" value="Pothole">Pothole</option>
            <option className="bg-panel" value="Streetlight">Streetlight</option>
            <option className="bg-panel" value="Accessibility">Accessibility</option>
            <option className="bg-panel" value="Garbage">Garbage</option>
            <option className="bg-panel" value="Other">Other</option>
          </select>
        </div>

        {selectedCategory === "Other" && (
          <div>
            <label
              className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
              htmlFor="report-custom-category"
            >
              Describe your category
            </label>
            <input
              autoComplete="off"
              className="block w-full rounded border border-white/10 bg-deep/70 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
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
            District / neighborhood
          </label>
          <input
            className="block w-full rounded border border-white/10 bg-deep/70 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
            id="report-district"
            maxLength={100}
            name="district"
            placeholder="e.g. North District / Ward 3"
            type="text"
          />
        </div>

        <LocationPicker onChange={setLocation} value={location} />

        <div>
          <label
            className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-muted"
            htmlFor="report-description"
          >
            Description
          </label>
          <textarea
            className="block min-h-32 w-full resize-y rounded border border-white/10 bg-deep/70 px-3.5 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
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
            Photo <span className="font-normal normal-case tracking-normal text-muted/70">(optional)</span>
          </label>
          <input
            className="block w-full cursor-pointer rounded border border-white/10 bg-deep/70 text-xs text-muted file:mr-4 file:cursor-pointer file:border-0 file:bg-panel-hover file:px-4 file:py-2.5 file:font-mono file:text-[10px] file:font-semibold file:uppercase file:text-cyan hover:file:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan/20"
            accept="image/*"
            id="report-photo"
            name="image"
            type="file"
          />
          <p className="mt-2 font-mono text-[9px] text-muted/70">
            Add a photo to help explain the issue. Images only — large photos are
            resized before upload.
          </p>
        </div>

        {submitError && (
          <p
            className="rounded border border-alert/20 bg-alert/10 px-4 py-3 text-sm text-alert"
            role="alert"
          >
            {submitError}
          </p>
        )}
        {submitSuccess && (
          <p
            aria-live="polite"
            className="rounded border border-mint/20 bg-mint/10 px-4 py-3 text-sm text-mint"
            role="status"
          >
            Your report was submitted. AI triage is running in the background — it
            will appear in the live feed shortly.
          </p>
        )}

        <button
          className="inline-flex w-full items-center justify-center rounded bg-gradient-to-r from-cyan to-mint px-4 py-3 font-mono text-xs font-semibold tracking-wide text-[#06202a] shadow-[0_0_16px_rgba(6,182,212,0.2)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Submitting…" : "Submit report"}
        </button>
      </form>
    </section>
  );
}
