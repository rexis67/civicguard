# CivicGuard — submission brief

Copy-paste material for the hackathon form, the repo description, and the live demo.

---

## One line

CivicGuard turns scattered municipal complaints into a ranked, live incident stream — citizens report in seconds, AI triages in the background, city staff work one prioritized queue.

## The problem

Municipal issues arrive through phone lines, email, social media and walk-ins, each in a different format. Staff manually re-type, de-duplicate and prioritize them, so a burst water main can sit behind a week of abandoned mattresses. Residents get no signal that anything happened.

## What it does

| Actor | Experience |
|---|---|
| **Citizen** | Report a pothole, streetlight, accessibility blocker or sanitation issue with a photo, district and description. No account needed. Watch the live feed update and see severity/urgency as AI finishes triage. |
| **AI triage** | Classifies the category, scores severity 1–5, assigns urgency, writes a factual summary and keyword tags. Runs **after** the HTTP response, so submission feels instant. |
| **Authority** | Invite-only dashboard with totals, critical counts, resolution rate, inline Pending → In Progress → Resolved workflow, CSV export and delete. |

## Why it stands out

- **One deployable service.** Express serves the API, the SPA and uploaded images behind one URL. No cross-origin setup, no second host, no static-site/API drift.
- **Asynchronous AI with graceful degradation.** A slow or failed model call never blocks a citizen or loses a report: the card shows *Analyzing* → *Manual review*, and staff can still work it.
- **Designed for the failure case.** Server-side input caps, MIME allowlist, rate limits, invite-gated authority signup, password-gated verification-link reissue, deny-by-default CORS, CSP/helmet, atomic JSON writes, timing-safe invite comparison, JSON 404s for `/api`.
- **Demo without quota.** `SEED_DEMO_DATA=true` loads 12 realistic incidents with pre-computed triage into an empty volume on first boot — the live demo is never empty and needs no AI calls.
- **Fast where it matters.** Custom cursor rewritten to 1:1 rAF tracking (zero layout reads per pointer event), photo downscaling before upload, newest-first feed, 5-second sync with in-flight request de-duplication.

## Stack

React 18 · Vite 6 · Tailwind CSS 3 · Express 4 · SQLite (better-sqlite3) · Google Gemini · Docker · GitHub Actions

## Architecture in one paragraph

The SPA talks only to `/api` on the same origin. Express validates and persists the report to an atomic JSON store, returns `201` immediately, and continues triage in the background. When Gemini responds, the analysis is patched onto the record (`analysisStatus: complete|failed`). Users live in SQLite with bcrypt hashes and signed JWTs; authority routes are role-guarded. Images go to local disk (`/uploads`) or S3 depending on `REPORT_IMAGE_STORAGE`.

## Three-minute demo script

1. **Open the feed.** 12 incidents, newest first, with severity bars, urgency badges and districts. Point out the *Auto-sync · 5 sec* indicator.
2. **Filter.** Click *Pothole*, then pick *Critical* urgency — the list narrows instantly, client-side.
3. **Submit a report.** Fill in a title and description, attach a photo, submit. It appears immediately with an **Analyzing** badge while triage runs. (With a live key it resolves in ~90 s; with the seeded data the triage state is already populated.)
4. **Sign in as authority.** Sign in with the invite code used at registration. With no SMTP configured, the verification link is returned only after the same password is submitted again. Open *Admin Incident Ops*: totals, critical count, resolution rate.
5. **Close the loop.** Move an incident to *In Progress*, then *Resolved* — the public card reflects it on the next sync. Export the CSV.

## Judge Q&A

**Why not block on AI?** The citizen's job is to report; the city's job is to triage. Blocking couples user success to a third-party model, which is the most likely thing to fail (quota, latency, outage).

**What happens when Gemini is down?** `analysisStatus: failed`, the card says *Manual review*, and the report is fully usable. The smoke suite asserts the request returns 201 without waiting for triage.

**How do you stop bad input?** 4,000-char description cap, 120-char title, 10 MB image limit, MIME allowlist, rate limits per IP, and explicit type/shape checks before anything reaches storage.

**Can it scale?** The JSON store is deliberate for demo size and atomic writes. The seam is `backend/services/db.js` — swap for Postgres without touching routes. Images already support S3.

**Accessibility?** Semantic landmarks, labelled inputs, `aria-live` status regions, keyboard-reachable controls, visible focus rings, a skip link, modal Escape/focus trap, and a custom cursor disabled for touch, narrow screens and `prefers-reduced-motion`. Fonts are self-hosted, and there is no analytics or third-party tracking; privacy and terms pages are linked in the footer.

## Known limitations

- Single-instance report store (JSON); horizontal scaling needs Postgres.
- AI triage is text + first image only, English.
- No duplicate clustering yet; nearby duplicates are a natural next step.
- No SMTP in the demo blueprint, so the verification link is echoed only after the account password is proved. Turn `RETURN_VERIFICATION_LINK` off once mail is configured.

## Submission checklist

- [x] Include the complete GitHub Copilot chat history at `backend/CIVICGAURD.json` (43 requests; metadata in `docs/copilot-evidence.md`).
- [x] README covers the concept, setup/run instructions and dependencies.
- [ ] Push this repo to GitHub (`npm run publish`, or the SSH push command).
- [ ] Deploy to Render with the blueprint in `render.yaml`; set `GEMINI_API_KEY` and a **new** `AUTHORITY_INVITE_CODE`.
- [ ] Open the deployed URL once, confirm 12 seeded incidents and one new submission.
- [ ] Email the GitHub repository link (and live demo URL) to **legacydavpv@gmail.com** before **25 October 2026, midnight**.

## Submission notes

- The brochure asks for the complete Copilot chat history in the repository; the export is tracked at `backend/CIVICGAURD.json` and described in `docs/copilot-evidence.md`.
- The brochure also requires participants to be able to explain and justify every part of the project. Be ready to walk through the auth flow (`backend/routes/auth.js`), AI triage (`backend/services/geminiService.js`), the report store (`backend/services/db.js`) and the React state flow (`src/App.jsx`). `README.md` has the architecture and API reference.
- The submission is the GitHub repository link sent by email; the live URL is supporting evidence, not a replacement for the repo.
