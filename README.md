# CivicGuard

**Municipal incident intelligence.** Citizens report potholes, broken streetlights, accessibility blockers and sanitation issues from any device; AI triages each report in the background; authority staff work a live operations dashboard.

Built with React + Vite on the front and Express + SQLite on the back, shipped as **one self-contained service** that hosts both the API and the built UI.

![CivicGuard live incident feed: 12 seeded incidents with severity, urgency, category, district and status](docs/screenshots/feed.png)

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Production build](#production-build)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [How AI triage works](#how-ai-triage-works)
- [Security model](#security-model)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Hackathon evidence](#hackathon-evidence)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Features

**Citizen**
- Submit an incident with a title, category, district, description and photo
- Optional location pin: click the map, drag the marker, or use browser geolocation
- No account needed to browse or submit; sign in to be recognised as a citizen
- Live feed with a severity-coloured incident map, full-text search, category/urgency/district filters and 5-second auto-sync
- Email verification flow with invite-gated authority accounts
- Privacy and terms pages, self-hosted fonts, no analytics or third-party trackers

**AI triage**
- Every report is classified into Pothole / Streetlight / Accessibility / Garbage
- Severity score (1–5), urgency level, factual summary and keyword tags
- Runs **asynchronously** — submission returns in milliseconds, the card updates when triage lands
- Graceful degradation: a timeout or provider outage flags the report for manual review instead of failing the request

**Authority**
- Dashboard with totals, critical counts and resolution rate
- Inline status workflow: Pending → In Progress → Resolved
- Delete incidents (with image cleanup), CSV export hardened against spreadsheet formula injection

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
  Browser ─────────▶│  Express (single service, port 5000)         │
   (React SPA)      │                                              │
                    │  GET  /                → dist/index.html     │
                    │  GET  /api/reports     → JSON report store   │
                    │  POST /api/reports     → save + 201, then    │
                    │                          triage in background│
                    │  PATCH/DELETE /api/reports/:id  (authority)  │
                    │  /api/auth/*           → JWT + verification  │
                    │  /uploads/*            → evidence images     │
                    └───────┬───────────────────────┬──────────────┘
                            │                       │
                   ┌────────▼────────┐      ┌───────▼─────────┐
                   │  SQLite (users, │      │ Gemini API      │
                   │  verification)  │      │ (async triage)  │
                   │  reports.json   │      └─────────────────┘
                   │  uploads/       │
                   └─────────────────┘
```

Everything mutable lives under one data directory (`/data` in Docker), which is the only path that needs a persistent volume.

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 18, Vite 6, Tailwind CSS 3, Leaflet |
| API | Express 4, Node 20+ |
| Auth | JWT (8 h), bcrypt (cost 12), email verification tokens hashed with SHA-256 |
| Storage | SQLite (`better-sqlite3`) for users, JSON document store for reports, local disk or S3-compatible object storage for images |
| Maps | Leaflet + Esri Dark Gray Canvas raster tiles (no API key), attribution shown in-map |
| AI | Google Gemini via `@google/genai`, schema-constrained JSON output |
| Ops | Docker, Render blueprint, GitHub Actions, `helmet`, `express-rate-limit` |

---

## Quick start

Requirements: Node.js 20+ and npm.

```bash
npm install
npm --prefix backend install
```

Create `backend/.env` from the template and add at minimum your Gemini key:

```bash
cp backend/.env.example backend/.env
# then edit GEMINI_API_KEY
```

Run the API and the Vite dev server in two terminals:

```bash
npm run dev:api    # Express on http://localhost:5000
npm run dev        # Vite on http://localhost:5173 (proxies /api and /uploads)
```

Open <http://localhost:5173>.

> No SMTP configured? Outside production the registration response includes the verification link, so you can activate an account without a mailbox. The link is only returned after the submitted password matches the stored account, and resend also requires the password. Set `RETURN_VERIFICATION_LINK=false` to disable echoing.

### Create an authority account

Authority sign-up requires the invite code from `AUTHORITY_INVITE_CODE`:

```bash
# register with role "authority" and the invite code, then follow the verification link
```

### Load demo data

The feed starts empty. To fill it with a realistic sample set — including
pre-computed triage so no Gemini calls are needed:

```bash
# stop the API first: it caches reports in memory
npm run seed
npm start
```

`npm run seed -- --force` replaces existing reports instead of refusing. The
seed refuses to run while the API is up so a live process cannot overwrite it.
On a host with a shell (e.g. Render), run the forced variant and then restart
the service so it reloads the seeded file.

---

## Production build

The Express server serves the compiled SPA, so one process is enough:

```bash
npm run build
npm start          # http://localhost:5000
```

`npm start` serves `dist/` when it exists and falls back to API-only mode otherwise.

---

## Deployment

### Render (recommended, free)

The repository ships a [`render.yaml`](render.yaml) blueprint configured for Render's **Free** plan (no card required):

1. Push the repo to GitHub — `npm run publish`. If the GitHub CLI is installed but not signed in, the script starts the browser sign-in flow, then creates the repo and pushes.
2. Render → **New → Blueprint** → select the repo.
3. Fill in `GEMINI_API_KEY` and a **new** `AUTHORITY_INVITE_CODE` when prompted.
4. Deploy. Render builds the Docker image, generates `JWT_SECRET`, sets `NODE_ENV=production`, and seeds 12 pre-triaged demo incidents on first boot (`SEED_DEMO_DATA=true`) so the live feed is never blank.

The free instance has 512 MB RAM and sleeps after 15 minutes idle, so the first request after a quiet period takes roughly a minute to wake. `/data` is ephemeral: SQLite, reports and uploads reset on restart/redeploy, and `SEED_DEMO_DATA=true` repopulates the 12 demo incidents on the next boot. That is fine for the hackathon demo. For persistence, switch `plan` to `starter` and add a 1 GB disk mounted at `/data` (paid), or point `REPORT_IMAGE_STORAGE=s3` and the database at hosted services.

Remove `SEED_DEMO_DATA` once the deployment receives real reports. The health check is `GET /api/health`. Because the blueprint provisions no SMTP credentials, it also sets `RETURN_VERIFICATION_LINK=true`: the register dialog hands you the verification link after the password check so accounts work out of the box. Configure SMTP and flip that to `false` for a real deployment.

Render injects `RENDER_EXTERNAL_URL`, so verification links, canonical tags and the sitemap use the real public origin. The app never derives those URLs from the request `Host` header.

### Docker / any container host

```bash
docker build -t civicguard .
docker run -p 5000:5000 \
  -e GEMINI_API_KEY=... \
  -e JWT_SECRET=... \
  -e AUTHORITY_INVITE_CODE=... \
  -v civicguard-data:/data \
  civicguard
```

Works unchanged on Railway, Fly.io, Azure Container Apps, ECS or a VPS. Mount a volume at `/data` so the SQLite database, reports and uploads survive restarts.

### Split frontend / backend

Deploy the API as above, then build the frontend against it:

```bash
PUBLIC_SITE_URL=https://civicguard.example \
VITE_API_URL=https://api.example.com \
npm run build
```

Serve `dist/` from any static host and add the frontend origin to `CORS_ORIGINS`. Set `FRONTEND_URL` on the API as well so verification emails and the sitemap point at the frontend origin.

---

## Configuration

All variables are optional except `GEMINI_API_KEY` for AI triage and `JWT_SECRET` in production. See [`backend/.env.example`](backend/.env.example) for the annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `NODE_ENV` | `development` | Enables production-only safety checks (JWT secret, SMTP, error redaction) |
| `SERVE_STATIC` | `true` | Serve the built SPA from Express |
| `FRONTEND_URL` | `http://localhost:5173` in dev; required in production unless `RENDER_EXTERNAL_URL` is set | Verification-link base URL; also an allowed CORS origin |
| `PUBLIC_SITE_URL` | falls back to `FRONTEND_URL` / `RENDER_EXTERNAL_URL` | Absolute origin for canonical tags and the sitemap |
| `CORS_ORIGINS` | – | Comma-separated additional allowed browser origins; unlisted origins are denied |
| `API_PUBLIC_BASE_URL` | – (relative `/uploads`) | Absolute base for locally stored image URLs |
| `GEMINI_API_KEY` | – | Enables AI triage (`503` on submission if unset) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model used for triage |
| `ANALYSIS_TIMEOUT_MS` | `180000` | Abandon a stalled triage and flag the report |
| `JWT_SECRET` | generated in dev | Must be ≥ 32 characters in production |
| `AUTHORITY_INVITE_CODE` | – | Required for authority self-registration |
| `AUTHORITY_EMAIL_DOMAINS` | – | Optional domain allowlist that bypasses the invite code |
| `RETURN_VERIFICATION_LINK` | `true` outside production | Echo the verification URL when SMTP is unavailable; only after the account password is proved (demo mode) |
| `AUTH_RATE_LIMIT` / `LOGIN_RATE_LIMIT` | `60` / `10` | Auth requests per 15 min per IP |
| `REPORT_RATE_LIMIT` | `30` | Report submissions per 10 min per IP |
| `TRUST_PROXY_HOPS` | `1` in production, else `0` | Reverse-proxy depth for correct client IPs |
| `CIVICGUARD_DB_PATH` | `backend/civicguard.sqlite` | User database |
| `CIVICGUARD_REPORTS_PATH` | `backend/reports.json` | Report store |
| `SEED_DEMO_DATA` | `false` | Load 12 pre-triaged incidents when the store is empty (demo deployments) |
| `UPLOAD_DIR` | `backend/uploads` | Local image directory |
| `REPORT_IMAGE_STORAGE` | `local` | `local` or `s3` |
| `SMTP_*` | – | Required in production for email verification |
| `S3_*`, `AWS_*` | – | Object storage when `REPORT_IMAGE_STORAGE=s3` |

---

## How AI triage works

1. `POST /api/reports` validates the payload, stores the image, appends the report with `analysisStatus: "pending"` and **responds immediately** (≈20 ms).
2. A background task sends the description and optional photo to Gemini with a JSON schema for category, severity, urgency, summary and tags.
3. On success the record is patched with the analysis, `analysisStatus: "complete"`, and the AI summary/category replace the provisional ones — unless the citizen typed their own title or category.
4. On timeout (`ANALYSIS_TIMEOUT_MS`) or provider failure the record is marked `analysisStatus: "failed"` with a manual-review message. The submission itself never fails.
5. The feed and dashboard poll every 5 seconds, so cards flip from **ANALYZING** to a graded incident without a refresh.

This replaced a synchronous call that blocked submissions for up to two minutes. With `gemini-3.8-flash`, a triage round trip currently takes roughly 100 seconds; the submission path is unaffected and `ANALYSIS_TIMEOUT_MS` controls when a slow call is abandoned for manual review.

> **Free-tier quota:** the Gemini free tier allows 20 requests per day for this model. Once exhausted, the API returns `429`, the report is flagged for manual review, and the app keeps working. Enable billing on the AI Studio key for an unrestricted demo.

## Security model

- Passwords hashed with bcrypt (cost 12); password length capped at 72 bytes (bcrypt limit).
- JWTs signed with a 32+ character secret, 8-hour expiry, issuer pinned; every request re-checks that the user still exists, is verified and still holds the claimed role.
- Email verification tokens are random 32-byte values, stored only as SHA-256 hashes, single-use with a 24-hour TTL.
- Authority registration requires the invite code or an explicitly allowlisted email domain — an address ending in `.gov` is **not** sufficient.
- The verification link is only echoed in API responses outside production, or when `RETURN_VERIFICATION_LINK=true` is set deliberately. Echoing requires proof of the account password (re-registering a pending account or calling resend with the password), so knowing an email address alone cannot claim a pending account. If no SMTP is configured and echoing is off, registration fails with a clear `503` instead of creating an account that can never be activated.
- Verification links are built from operator/platform origins (`FRONTEND_URL`, `PUBLIC_SITE_URL`, `RENDER_EXTERNAL_URL`), never the request `Host` header, closing the host-header token-theft path.
- Rate limits on auth (per IP, tighter on login) and on report submission, which also protects the Gemini quota.
- Image uploads are restricted to a MIME allowlist (PNG, JPEG, WebP, GIF, AVIF, HEIC/HEIF), 10 MB max, stored under UUID filenames.
- `helmet` sets CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`, `nosniff` and a no-referrer policy. CORS denies browser origins that are not listed; same-origin requests need no configuration.
- CSV export neutralises formula injection (`=`, `+`, `-`, `@`).
- No HTML injection surface: report content is rendered through React, never `dangerouslySetInnerHTML`.
- No analytics, advertising cookies or third-party font CDN. Fonts are self-hosted, the only browser storage is the auth token, and the footer links to accurate privacy and terms pages.

**Deployment checklist**

- [ ] `JWT_SECRET` and `AUTHORITY_INVITE_CODE` set to long random values
- [ ] `NODE_ENV=production`, `RETURN_VERIFICATION_LINK` unset or `false`
- [ ] SMTP configured, or `RETURN_VERIFICATION_LINK=true` left on for a demo (turn it off once SMTP works)
- [ ] `CORS_ORIGINS` set if the API is on a different origin
- [ ] Volume mounted at `/data`
- [ ] `TRUST_PROXY_HOPS` matches your proxy

## API reference

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | – | Liveness probe |
| `GET` | `/api/reports` | – | All reports (newest data, full list) |
| `GET` | `/api/reports/:id` | – | Single report |
| `POST` | `/api/reports` | – | Submit a report (`multipart/form-data`: `description`, `category`, `customCategory`, `district`, `title`, `latitude`, `longitude`, `image`). Latitude/longitude are optional but must be supplied as a valid pair. |
| `PATCH` | `/api/reports/:id/status` | Authority | `{ "status": "Pending" \| "In Progress" \| "Resolved" }` |
| `DELETE` | `/api/reports/:id` | Authority | Delete a report and its image |
| `POST` | `/api/auth/register` | – | `{ name, email, password, role, inviteCode? }` |
| `POST` | `/api/auth/login` | – | `{ email, password }` → `{ token, user }` |
| `POST` | `/api/auth/verify-email` | – | `{ token }` → `{ token, user }` |
| `POST` | `/api/auth/resend-verification` | – | `{ email, password }` → generic message, plus the link in demo mode when the password matches |

## Project structure

```
.
├── backend/
│   ├── CIVICGAURD.json         # required Copilot chat export (43 requests)
│   ├── middleware/auth.js      # JWT verification + role guard
│   ├── routes/auth.js          # register / login / verification
│   ├── services/db.js          # SQLite users + JSON report store
│   ├── services/geminiService.js
│   ├── services/imageStorage.js # local disk or S3
│   ├── services/jwtSecret.js
│   ├── services/mailer.js
│   └── server.js               # API + static SPA + background triage
├── src/
│   ├── components/             # feed, form, dashboard, login, cursor
│   ├── context/AuthContext.jsx
│   ├── services/api.js
│   └── App.jsx
├── scripts/smoke.mjs           # end-to-end API checks (CI)
├── scripts/seed.mjs            # demo incident set with pre-computed triage
├── docs/copilot-evidence.md    # export metadata, hash and redactions
├── Dockerfile
├── render.yaml
└── .github/workflows/ci.yml
```

## Testing

```bash
npm run test:smoke
```

Boots the API against a throwaway data directory and asserts 35 behaviours: health, auth lifecycle, invite-gated authority registration, `.gov` escalation rejection, password-gated verification-link reissue, CORS allow/deny, `robots.txt` and `sitemap.xml`, publish-without-waiting triage, host-independent image URLs, MIME rejection, overlong input rejection, map-coordinate validation, role-guarded status updates and deletes, invalid input handling and JSON 404s. CI runs the same suite on every push along with a production build.

## Hackathon evidence

The **LEGACY 8.0** hackathon requires the complete GitHub Copilot chat history as a JSON file. The export used to build CivicGuard is committed at [`backend/CIVICGAURD.json`](backend/CIVICGAURD.json) — **43 Copilot requests** from the 24–25 October 2026 build session.

The same conversation is also readable in chat form with no tooling: [`docs/copilot-chat-transcript.md`](docs/copilot-chat-transcript.md) (Markdown) and [`docs/copilot-chat.html`](docs/copilot-chat.html) (chat-style viewer). See [`docs/copilot-evidence.md`](docs/copilot-evidence.md) for the export metadata, SHA-256 integrity hash, verification commands and the three credentials/personal identifiers redacted before publication. No live API keys, tokens, password hashes or production invite codes are in the repository.

## Known limitations

- Reports are stored as a JSON document, not in SQLite: fine for a demo-scale deployment, not for concurrent multi-instance scaling.
- Status changes do not yet record an audit trail (actor, timestamp, note).
- Email verification is required, so a deployment without SMTP cannot onboard users unless `RETURN_VERIFICATION_LINK` is enabled.
- No automated UI tests in CI; Playwright checks for layout, modal accessibility, form submission and the map/location picker were run manually.
- The free Render deployment uses ephemeral storage: the 12 demo incidents reseed, but user accounts, reports and uploads reset on restart/redeploy. Use the Starter disk for persistence.
- AI triage depends on the Gemini free-tier quota (20 reports/day for `gemini-3.8-flash`); exhausted quota degrades gracefully to manual review.

## License

MIT — see [LICENSE](LICENSE).
