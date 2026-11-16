import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "civicguard-smoke-"));
const results = [];
const webhookRequests = [];
const webhookServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    webhookRequests.push(body);
    response.writeHead(200).end("ok");
  });
});
await new Promise((resolve, reject) => {
  webhookServer.once("error", reject);
  webhookServer.listen(0, "127.0.0.1", resolve);
});
const webhookPort = webhookServer.address().port;

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function pngFixtureWithExif() {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const dimensions = Buffer.alloc(13);
  dimensions.writeUInt32BE(1, 0);
  dimensions.writeUInt32BE(1, 4);
  dimensions[8] = 8;
  dimensions[9] = 6;
  const pixels = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([
    header,
    pngChunk("IHDR", dimensions),
    pngChunk("eXIf", Buffer.from("II*\0GPS metadata test", "ascii")),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function jsonRequest(method, route, body, token) {
  const headers = {};
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

const server = spawn(process.execPath, ["backend/server.js"], {
  cwd: workspace,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    SERVE_STATIC: "false",
    DB_PATH: path.join(tempDir, "smoke.sqlite"),
    CIVICGUARD_REPORTS_PATH: path.join(tempDir, "reports.json"),
    UPLOAD_DIR: path.join(tempDir, "uploads"),
    GEMINI_API_KEY: "",
    MAPTILER_API_KEY: "smoke-maptiler-public-key",
    AUTHORITY_INVITE_CODE: "smoke-invite",
    JWT_SECRET: "smoke-test-secret-that-is-definitely-long-enough",
    ALERT_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/alerts`,
    FRONTEND_URL: "https://civicguard.test",
    AUTH_RATE_LIMIT: "1000",
    LOGIN_RATE_LIMIT: "1000",
    REPORT_RATE_LIMIT: "1000",
    RETURN_VERIFICATION_LINK: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  const healthy = await waitForHealth();
  if (!healthy) throw new Error(`Server did not start:\n${serverOutput}`);
  const healthResponse = await fetch(`${BASE}/api/health`);
  const healthBody = await healthResponse.json().catch(() => null);
  check(
    "GET /api/health checks SQLite and image storage",
    healthy &&
      healthResponse.status === 200 &&
      healthBody.status === "ok" &&
      healthBody.database === "ok" &&
      healthBody.imageStorage?.status === "ok",
    healthy ? `status=${healthResponse.status}` : "timed out",
  );
  const publicConfig = await jsonRequest("GET", "/api/public-config");
  check(
    "public config exposes only the configured browser map provider key",
    publicConfig.status === 200 &&
      publicConfig.body.mapProvider === "maptiler" &&
      publicConfig.body.mapTilerKey === "smoke-maptiler-public-key",
  );

  const empty = await jsonRequest("GET", "/api/reports");
  check(
    "GET /api/reports (empty)",
    empty.status === 200 && empty.body.total === 0 && empty.body.data.length === 0,
  );
  const invalidPage = await jsonRequest("GET", "/api/reports?limit=0");
  check("GET /api/reports rejects invalid pagination", invalidPage.status === 400);
  const cappedPage = await jsonRequest("GET", "/api/reports?limit=500");
  check(
    "GET /api/reports caps page size at 100",
    cappedPage.status === 200 && cappedPage.body.limit === 100,
  );
  const cityHealth = await jsonRequest("GET", "/api/city-health");
  check(
    "GET /api/city-health exposes public aggregates only",
    cityHealth.status === 200 &&
      cityHealth.body.totalReports === 0 &&
      cityHealth.body.openReports === 0 &&
      cityHealth.body.resolvedReports === 0 &&
      cityHealth.body.resolutionRateByCategory.length === 0 &&
      cityHealth.body.mapCells.length === 0 &&
      !("reports" in cityHealth.body),
  );

  const deniedCors = await fetch(`${BASE}/api/reports`, {
    headers: { Origin: "https://evil.example" },
  });
  check(
    "CORS denies an unlisted browser origin",
    deniedCors.status === 200 && !deniedCors.headers.get("access-control-allow-origin"),
  );

  const allowedCors = await fetch(`${BASE}/api/reports`, {
    headers: { Origin: "https://civicguard.test" },
  });
  check(
    "CORS allows the configured origin",
    allowedCors.headers.get("access-control-allow-origin") === "https://civicguard.test",
  );

  const robots = await fetch(`${BASE}/robots.txt`);
  const robotsText = await robots.text();
  check(
    "robots.txt is served with the sitemap URL",
    robots.status === 200 && robotsText.includes("Sitemap: https://civicguard.test/sitemap.xml"),
  );

  const sitemap = await fetch(`${BASE}/sitemap.xml`);
  const sitemapText = await sitemap.text();
  check(
    "sitemap.xml lists the public pages",
    sitemap.status === 200 &&
      sitemapText.includes("<loc>https://civicguard.test/</loc>") &&
      sitemapText.includes("<loc>https://civicguard.test/privacy.html</loc>"),
  );

  const stamp = Date.now();
  const citizenEmail = `smoke.citizen.${stamp}@example.com`;
  const registration = await jsonRequest("POST", "/api/auth/register", {
    name: "Smoke Citizen",
    email: citizenEmail,
    password: "CorrectHorse9!",
    role: "citizen",
  });
  check("POST /api/auth/register", registration.status === 201, `status=${registration.status}`);
  check(
    "verification link uses the configured public origin",
    String(registration.body.verificationUrl).startsWith("https://civicguard.test/?verifyEmail="),
  );

  const token = new URL(registration.body.verificationUrl).searchParams.get("verifyEmail");
  const verification = await jsonRequest("POST", "/api/auth/verify-email", { token });
  check(
    "POST /api/auth/verify-email",
    verification.status === 200 && verification.body.user.role === "citizen",
  );
  const citizenToken = verification.body.token;

  const login = await jsonRequest("POST", "/api/auth/login", {
    email: citizenEmail,
    password: "CorrectHorse9!",
  });
  check("POST /api/auth/login", login.status === 200 && Boolean(login.body.token));

  const badLogin = await jsonRequest("POST", "/api/auth/login", {
    email: citizenEmail,
    password: "wrong-password",
  });
  check("POST /api/auth/login (wrong password -> 401)", badLogin.status === 401);

  const pendingEmail = `smoke.pending.${stamp}@example.com`;
  const pendingRegistration = await jsonRequest("POST", "/api/auth/register", {
    name: "Pending Citizen",
    email: pendingEmail,
    password: "CorrectHorse9!",
    role: "citizen",
  });
  check("pending account registration", pendingRegistration.status === 201);

  const resendWithoutPassword = await jsonRequest("POST", "/api/auth/resend-verification", {
    email: pendingEmail,
  });
  check("resend without password -> 400", resendWithoutPassword.status === 400);

  const resendWrongPassword = await jsonRequest("POST", "/api/auth/resend-verification", {
    email: pendingEmail,
    password: "wrong-password",
  });
  check(
    "resend with wrong password returns no link",
    resendWrongPassword.status === 200 && !resendWrongPassword.body.verificationUrl,
  );

  const resendCorrectPassword = await jsonRequest("POST", "/api/auth/resend-verification", {
    email: pendingEmail,
    password: "CorrectHorse9!",
  });
  check(
    "resend with the correct password returns a link",
    resendCorrectPassword.status === 200 && Boolean(resendCorrectPassword.body.verificationUrl),
  );

  const reRegisterWrongPassword = await jsonRequest("POST", "/api/auth/register", {
    name: "Pending Citizen",
    email: pendingEmail,
    password: "wrong-password",
    role: "citizen",
  });
  check(
    "re-registering a pending account with the wrong password returns no link",
    reRegisterWrongPassword.status === 202 && !reRegisterWrongPassword.body.verificationUrl,
  );

  const reRegisterCorrectPassword = await jsonRequest("POST", "/api/auth/register", {
    name: "Pending Citizen",
    email: pendingEmail,
    password: "CorrectHorse9!",
    role: "citizen",
  });
  check(
    "re-registering a pending account with the correct password returns a link",
    reRegisterCorrectPassword.status === 202 &&
      Boolean(reRegisterCorrectPassword.body.verificationUrl),
  );

  const noInvite = await jsonRequest("POST", "/api/auth/register", {
    name: "No Invite",
    email: `smoke.authority.${stamp}@example.com`,
    password: "CorrectHorse9!",
    role: "authority",
  });
  check("authority without invite is rejected", noInvite.status === 403);

  const hostileDomain = await jsonRequest("POST", "/api/auth/register", {
    name: "Fake Gov",
    email: `mayor.${stamp}@not-a-real-city.gov`,
    password: "CorrectHorse9!",
    role: "authority",
  });
  check("authority via .gov domain is rejected", hostileDomain.status === 403);

  const authorityRegistration = await jsonRequest("POST", "/api/auth/register", {
    name: "Smoke Authority",
    email: `smoke.staff.${stamp}@example.com`,
    password: "CorrectHorse9!",
    role: "authority",
    inviteCode: "smoke-invite",
  });
  check("authority with invite code is accepted", authorityRegistration.status === 201);

  const staffTokenRaw = new URL(authorityRegistration.body.verificationUrl).searchParams.get(
    "verifyEmail",
  );
  const staffVerification = await jsonRequest("POST", "/api/auth/verify-email", {
    token: staffTokenRaw,
  });
  const staffToken = staffVerification.body.token;
  const staffUserId = staffVerification.body.user.id;
  check(
    "authority verification",
    staffVerification.status === 200 && staffVerification.body.user.role === "authority",
  );
  const citizenUserList = await jsonRequest("GET", "/api/users", undefined, citizenToken);
  check("citizens cannot access user management", citizenUserList.status === 403);
  const staffUserList = await jsonRequest("GET", "/api/users", undefined, staffToken);
  check(
    "authority can list users without password hashes",
    staffUserList.status === 200 &&
      staffUserList.body.some((user) => user.id === staffUserId) &&
      staffUserList.body.every((user) => !("passwordHash" in user) && !("password_hash" in user)),
  );
  const pendingUser = staffUserList.body.find((user) => user.email === pendingEmail);
  const deleteUserResponse = await jsonRequest(
    "DELETE",
    `/api/users/${pendingUser?.id ?? "missing-user"}`,
    undefined,
    staffToken,
  );
  check("authority can delete another user account", deleteUserResponse.status === 200);

  const open311Services = await fetch(`${BASE}/open311/v2/services.json`);
  const open311Catalog = await open311Services.json();
  check(
    "Open311 services endpoint returns CivicGuard categories",
    open311Services.status === 200 &&
      Array.isArray(open311Catalog) &&
      open311Catalog.some((service) => service.service_code === "streetlight"),
  );
  const open311ApiAlias = await fetch(`${BASE}/api/open311/v2/services.json`);
  check("Open311 services are also available under the API prefix", open311ApiAlias.status === 200);
  const invalidOpen311Date = await fetch(
    `${BASE}/open311/v2/requests.json?start_date=not-a-date`,
  );
  check("Open311 rejects malformed date filters", invalidOpen311Date.status === 400);
  const invalidOpen311Create = await fetch(`${BASE}/open311/v2/requests.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      service_code: "unknown",
      description: "Invalid service code.",
      address: "Somewhere",
    }),
  });
  check("Open311 rejects unknown service codes", invalidOpen311Create.status === 400);

  const form = new FormData();
  form.set("description", "Large pothole on 5th and Main, creating a fall risk for wheelchair users.");
  form.set("category", "Pothole");
  form.set("district", "North");
  form.set("latitude", "12.9716");
  form.set("longitude", "77.5946");
  const created = await fetch(`${BASE}/api/reports`, { method: "POST", body: form });
  const createdReport = await created.json();
  check(
    "POST /api/reports responds immediately with tracking and SLA data",
    created.status === 201 &&
      createdReport.analysisStatus === "pending" &&
      /^CG-[A-Z0-9]{5}$/.test(createdReport.trackingCode) &&
      Boolean(createdReport.slaDueAt) &&
      Boolean(createdReport.department),
    `status=${created.status}`,
  );
  const pendingTriageRetry = await jsonRequest(
    "POST",
    `/api/reports/${createdReport.id}/triage`,
  );
  check(
    "triage retry accepts failed reports and rejects reports already in progress",
    pendingTriageRetry.status === 409 ||
      (pendingTriageRetry.status === 202 &&
        pendingTriageRetry.body.analysisStatus === "pending"),
  );
  const missingTriageRetry = await jsonRequest("POST", "/api/reports/missing-report/triage");
  check("triage retry returns 404 for an unknown report", missingTriageRetry.status === 404);
  check(
    "valid map location is stored",
    createdReport.location?.lat === 12.9716 && createdReport.location?.lng === 77.5946,
  );
  let triagedReport = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await jsonRequest("GET", `/api/reports/${createdReport.id}`);
    triagedReport = result.body;
    if (triagedReport?.analysisStatus !== "pending") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(
    "Gemini failure falls back to rules-based triage with confidence",
    triagedReport?.analysisStatus === "triaged-by-rules" &&
      triagedReport.analysis?.confidence === 0.35 &&
      triagedReport.analysis?.detectedLanguage === "und" &&
      triagedReport.analysis?.riskToVulnerable === true &&
      triagedReport.severityScore === 5 &&
      triagedReport.analysis?.riskReason?.length > 0,
    `severity=${triagedReport?.severityScore}; vulnerableRisk=${triagedReport?.analysis?.riskToVulnerable}`,
  );
  for (let attempt = 0; attempt < 20 && webhookRequests.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check(
    "critical triage sends a concise optional webhook alert with a public tracking link",
    webhookRequests.length === 1 &&
      webhookRequests[0].includes("Critical CivicGuard report") &&
      webhookRequests[0].includes(`/track/${createdReport.trackingCode}`),
  );
  const cityHealthWithReport = await jsonRequest("GET", "/api/city-health");
  check(
    "City Health counts reports and returns only rounded aggregate map cells",
    cityHealthWithReport.status === 200 &&
      cityHealthWithReport.body.totalReports === 1 &&
      cityHealthWithReport.body.openReports === 1 &&
      cityHealthWithReport.body.mapCells[0]?.lat === 12.97 &&
      cityHealthWithReport.body.mapCells[0]?.lng === 77.59 &&
      !JSON.stringify(cityHealthWithReport.body).includes("Large pothole") &&
      !("id" in cityHealthWithReport.body.mapCells[0]),
  );

  const duplicateForm = new FormData();
  duplicateForm.set("description", "Another report about the nearby pothole.");
  duplicateForm.set("category", "Pothole");
  duplicateForm.set("latitude", "12.97165");
  duplicateForm.set("longitude", "77.5946");
  const duplicateResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: duplicateForm,
  });
  const duplicateReport = await duplicateResponse.json();
  const trackingResponse = await jsonRequest("GET", `/api/track/${duplicateReport.trackingCode}`);
  check(
    "nearby same-category report is linked and exposes a private-data-free tracking timeline",
    duplicateResponse.status === 201 &&
      duplicateReport.duplicateOf === createdReport.id &&
      trackingResponse.status === 200 &&
      trackingResponse.body.timeline.length >= 1 &&
      !("description" in trackingResponse.body) &&
      !("district" in trackingResponse.body),
    `submit=${duplicateResponse.status}, link=${duplicateReport.duplicateOf ?? "none"}, tracking=${trackingResponse.status}`,
  );
  const confirmationDeviceHash = "a".repeat(64);
  const firstConfirmation = await jsonRequest(
    "POST",
    `/api/reports/${createdReport.id}/confirm`,
    { deviceHash: confirmationDeviceHash },
  );
  const duplicateConfirmation = await jsonRequest(
    "POST",
    `/api/reports/${createdReport.id}/confirm`,
    { deviceHash: confirmationDeviceHash },
  );
  check(
    "one device can confirm an incident once and confirmation totals are returned",
    firstConfirmation.status === 201 &&
      firstConfirmation.body.confirmationCount === 1 &&
      duplicateConfirmation.status === 409 &&
      duplicateConfirmation.body.confirmationCount === 1,
  );
  const cityHealthAfterConfirmation = await jsonRequest("GET", "/api/city-health");
  check(
    "City Health counts submitted reports without counting confirmations as submissions",
    cityHealthAfterConfirmation.body.totalReports === 2 &&
      cityHealthAfterConfirmation.body.mapCells[0]?.count === 2,
  );
  const adminReportPage = await jsonRequest("GET", "/api/admin/reports", undefined, staffToken);
  const impactMetrics = await jsonRequest("GET", "/api/admin/metrics", undefined, staffToken);
  const splitDuplicate = await jsonRequest(
    "POST",
    `/api/reports/${duplicateReport.id}/split`,
    undefined,
    staffToken,
  );
  const mergeDuplicate = await jsonRequest(
    "POST",
    `/api/reports/${duplicateReport.id}/merge`,
    { targetId: createdReport.id },
    staffToken,
  );
  check(
    "authority can review, split, and re-merge duplicate reports with impact metrics",
    adminReportPage.status === 200 &&
      adminReportPage.body.total === 2 &&
      impactMetrics.status === 200 &&
      impactMetrics.body.totalSubmissions === 3 &&
      splitDuplicate.status === 200 &&
      mergeDuplicate.status === 200,
  );
  const reportBeforeOverride = await jsonRequest("GET", `/api/reports/${createdReport.id}`);
  const overrideCategory = reportBeforeOverride.body.category === "Streetlight" ? "Garbage" : "Streetlight";
  const previousSeverity = Number(
    reportBeforeOverride.body.analysis?.severityScore ??
      reportBeforeOverride.body.severityScore ??
      3,
  );
  const overrideSeverity = previousSeverity >= 5 ? 4 : 5;
  const triageOverride = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/triage-review`,
    { category: overrideCategory, severityScore: overrideSeverity },
    staffToken,
  );
  const fieldAudit = await jsonRequest(
    "GET",
    `/api/reports/${createdReport.id}/field-audits`,
    undefined,
    staffToken,
  );
  check(
    "authority triage overrides are audited and update department SLA",
    triageOverride.status === 200 &&
      triageOverride.body.category === overrideCategory &&
      triageOverride.body.department === (overrideCategory === "Streetlight" ? "Electrical Services" : "Sanitation") &&
      fieldAudit.status === 200 &&
      fieldAudit.body.length === 2,
    `override=${triageOverride.status}/${triageOverride.body.error ?? triageOverride.body.department}, audits=${fieldAudit.status}/${fieldAudit.body.length ?? fieldAudit.body.error}`,
  );

  const honeypotForm = new FormData();
  honeypotForm.set("description", "A test bot should not submit this.");
  honeypotForm.set("website", "automated-link");
  const honeypotResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: honeypotForm,
  });
  check("report honeypot blocks filled submissions", honeypotResponse.status === 400);

  const reportPage = await jsonRequest("GET", "/api/reports?limit=1&offset=0");
  check(
    "GET /api/reports returns pagination metadata",
    reportPage.status === 200 &&
      reportPage.body.limit === 1 &&
      reportPage.body.offset === 0 &&
      reportPage.body.total === 1 &&
      reportPage.body.data.length === 1,
  );
  const assignment = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/assignment`,
    { assignedTo: staffUserId },
    staffToken,
  );
  check(
    "authority can assign a report to verified staff",
    assignment.status === 200 && assignment.body.assignedTo === staffUserId,
  );
  const assignedPage = await jsonRequest(
    "GET",
    `/api/reports?assignedTo=${encodeURIComponent(staffUserId)}`,
  );
  check(
    "report list can be filtered by assignee",
    assignedPage.status === 200 &&
      assignedPage.body.total === 1 &&
      assignedPage.body.data[0]?.id === createdReport.id,
  );

  const partialLocationForm = new FormData();
  partialLocationForm.set("description", "Pothole with only half a coordinate pair.");
  partialLocationForm.set("latitude", "12.9716");
  const partialLocationResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: partialLocationForm,
  });
  check("partial map coordinates rejected -> 400", partialLocationResponse.status === 400);

  const outOfRangeLocationForm = new FormData();
  outOfRangeLocationForm.set("description", "Pothole outside the valid coordinate range.");
  outOfRangeLocationForm.set("latitude", "120");
  outOfRangeLocationForm.set("longitude", "77.5946");
  const outOfRangeLocationResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: outOfRangeLocationForm,
  });
  check("out-of-range map coordinates rejected -> 400", outOfRangeLocationResponse.status === 400);

  const duplicateStatus = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/status`,
    { status: "Resolved" },
  );
  check("status update without token -> 401", duplicateStatus.status === 401);

  const overlongForm = new FormData();
  overlongForm.set("description", "x".repeat(4001));
  const overlongResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: overlongForm,
  });
  check("overlong description rejected -> 400", overlongResponse.status === 400);

  const overlongTitleForm = new FormData();
  overlongTitleForm.set("description", "Streetlight out on the corner.");
  overlongTitleForm.set("title", "t".repeat(121));
  const overlongTitleResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: overlongTitleForm,
  });
  check("overlong title rejected -> 400", overlongTitleResponse.status === 400);

  const imageForm = new FormData();
  imageForm.set("description", "Broken kerb outside the central library.");
  imageForm.set(
    "image",
    new Blob([pngFixtureWithExif()], { type: "image/png" }),
    "kerb.png",
  );
  const imageResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: imageForm,
  });
  const imageReport = await imageResponse.json();
  const storedImageResponse = imageReport.image?.url
    ? await fetch(`${BASE}${imageReport.image.url}`)
    : null;
  const storedImageBytes = storedImageResponse
    ? Buffer.from(await storedImageResponse.arrayBuffer())
    : Buffer.alloc(0);
  check(
    "image upload strips EXIF metadata and stores a host-independent URL",
    imageResponse.status === 201 &&
      String(imageReport.image?.url).startsWith("/uploads/") &&
      storedImageResponse?.status === 200 &&
      !storedImageBytes.includes(Buffer.from("eXIf")) &&
      !storedImageBytes.includes(Buffer.from("GPS metadata test")),
    `status=${imageResponse.status}, ${imageReport.image?.url ?? imageReport.error ?? "no image response"}`,
  );
  let photoTriage = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await jsonRequest("GET", `/api/reports/${imageReport.id}`);
    photoTriage = result.body;
    if (photoTriage?.analysisStatus !== "pending") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check(
    "photo triage failure leaves the report intact and marks its photo for staff review",
    photoTriage?.analysisStatus === "triaged-by-rules" &&
      photoTriage.image?.url &&
      photoTriage.analysis?.photoQuality === null,
  );

  const badTypeForm = new FormData();
  badTypeForm.set("description", "Attached a text file instead of a photo.");
  badTypeForm.set(
    "image",
    new Blob([Buffer.from("not an image")], { type: "text/plain" }),
    "note.txt",
  );
  const badTypeResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: badTypeForm,
  });
  check("non-image upload rejected -> 400", badTypeResponse.status === 400);

  const statusUpdate = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/status`,
    { status: "In Progress", note: "Crew dispatched to inspect the site." },
    staffToken,
  );
  check(
    "status update as authority",
    statusUpdate.status === 200 && statusUpdate.body.status === "In Progress",
  );
  const auditTrail = await jsonRequest(
    "GET",
    `/api/reports/${createdReport.id}/audits`,
    undefined,
    staffToken,
  );
  check(
    "status updates are recorded with actor and note",
    auditTrail.status === 200 &&
      auditTrail.body[0]?.previousStatus === "Pending" &&
      auditTrail.body[0]?.newStatus === "In Progress" &&
      auditTrail.body[0]?.actorEmail === "smoke.staff." + stamp + "@example.com" &&
      auditTrail.body[0]?.note === "Crew dispatched to inspect the site.",
  );
  const resolutionProofForm = new FormData();
  resolutionProofForm.set("status", "Resolved");
  resolutionProofForm.set("note", "The damaged surface has been repaired.");
  resolutionProofForm.set(
    "afterPhoto",
    new Blob([pngFixtureWithExif()], { type: "image/png" }),
    "repaired.png",
  );
  const resolutionProofResponse = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/status`,
    resolutionProofForm,
    staffToken,
  );
  const resolvedReport = resolutionProofResponse.body;
  const afterPhotoResponse = resolvedReport.afterPhoto?.url
    ? await fetch(`${BASE}${resolvedReport.afterPhoto.url}`)
    : null;
  const afterPhotoBytes = afterPhotoResponse
    ? Buffer.from(await afterPhotoResponse.arrayBuffer())
    : Buffer.alloc(0);
  const publicTrackingAfterResolve = await jsonRequest(
    "GET",
    `/api/track/${createdReport.trackingCode}`,
  );
  check(
    "staff can resolve with a sanitized after photo and public tracking proof",
    resolutionProofResponse.status === 200 &&
      resolvedReport.status === "Resolved" &&
      resolvedReport.afterNote === "The damaged surface has been repaired." &&
      afterPhotoResponse?.status === 200 &&
      !afterPhotoBytes.includes(Buffer.from("eXIf")) &&
      publicTrackingAfterResolve.body.afterPhoto?.url === resolvedReport.afterPhoto.url &&
      !("description" in publicTrackingAfterResolve.body),
    `status=${resolutionProofResponse.status}; note=${resolvedReport.afterNote}; photo=${afterPhotoResponse?.status}; tracking=${publicTrackingAfterResolve.status}`,
  );
  const promoteCitizen = await jsonRequest(
    "PATCH",
    `/api/users/${verification.body.user.id}/role`,
    { role: "authority" },
    staffToken,
  );
  check(
    "authority can change user roles",
    promoteCitizen.status === 200 && promoteCitizen.body.role === "authority",
  );
  const demoteCitizen = await jsonRequest(
    "PATCH",
    `/api/users/${verification.body.user.id}/role`,
    { role: "citizen" },
    staffToken,
  );
  check("authority can restore citizen role", demoteCitizen.status === 200 && demoteCitizen.body.role === "citizen");
  const deleteSelf = await jsonRequest(
    "DELETE",
    `/api/users/${staffUserId}`,
    undefined,
    staffToken,
  );
  check("authority cannot delete its own account", deleteSelf.status === 409);
  const demoteSelf = await jsonRequest(
    "PATCH",
    `/api/users/${staffUserId}/role`,
    { role: "citizen" },
    staffToken,
  );
  check("authority cannot demote its own account", demoteSelf.status === 409);

  const invalidStatus = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/status`,
    { status: "Banana" },
    staffToken,
  );
  check("invalid status -> 400", invalidStatus.status === 400);

  const citizenDelete = await jsonRequest(
    "DELETE",
    `/api/reports/${createdReport.id}`,
    undefined,
    citizenToken,
  );
  check("citizen cannot delete -> 403", citizenDelete.status === 403);

  const staffDelete = await jsonRequest(
    "DELETE",
    `/api/reports/${createdReport.id}`,
    undefined,
    staffToken,
  );
  check("authority delete", staffDelete.status === 200);

  const open311Create = await fetch(`${BASE}/open311/v2/requests.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      service_code: "streetlight",
      description: "Streetlight outage reported through Open311.",
      lat: "12.9831",
      long: "77.6012",
    }),
  });
  const open311Created = (await open311Create.json())[0];
  check(
    "Open311 creates a CivicGuard report and returns a service request",
    open311Create.status === 200 &&
      Boolean(open311Created?.service_request_id) &&
      open311Created?.service_code === "streetlight" &&
      open311Created?.status === "open" &&
      open311Created?.lat === "12.9831",
  );
  const open311Lookup = await fetch(
    `${BASE}/open311/v2/requests.json?service_request_id=${encodeURIComponent(open311Created.service_request_id)}`,
  );
  const open311LookupBody = await open311Lookup.json();
  check(
    "Open311 filters requests by service_request_id",
    open311Lookup.status === 200 &&
      open311LookupBody.length === 1 &&
      open311LookupBody[0].service_request_id === open311Created.service_request_id,
  );

  const missingRoute = await jsonRequest("GET", "/api/does-not-exist");
  check("unknown API route -> JSON 404", missingRoute.status === 404 && missingRoute.body.error);

  const metricsJson = await jsonRequest("GET", "/api/metrics?format=json");
  check(
    "GET /api/metrics exposes JSON observability telemetry",
    metricsJson.status === 200 &&
      Number.isFinite(metricsJson.body?.uptimeSeconds) &&
      typeof metricsJson.body?.triageQueue === "object",
  );

  const metricsProm = await fetch(`${BASE}/api/metrics`);
  const metricsPromText = await metricsProm.text();
  check(
    "GET /api/metrics exposes Prometheus exposition format",
    metricsProm.status === 200 && metricsPromText.includes("civicguard_uptime_seconds"),
  );

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!server.killed) server.kill("SIGKILL");
  await new Promise((resolve) => webhookServer.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
