import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "civicguard-smoke-"));
const results = [];

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
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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
    CIVICGUARD_DB_PATH: path.join(tempDir, "smoke.sqlite"),
    CIVICGUARD_REPORTS_PATH: path.join(tempDir, "reports.json"),
    UPLOAD_DIR: path.join(tempDir, "uploads"),
    GEMINI_API_KEY: "",
    AUTHORITY_INVITE_CODE: "smoke-invite",
    JWT_SECRET: "smoke-test-secret-that-is-definitely-long-enough",
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
  check("GET /api/health", healthy, healthy ? "200" : "timed out");
  if (!healthy) throw new Error(`Server did not start:\n${serverOutput}`);

  const empty = await jsonRequest("GET", "/api/reports");
  check("GET /api/reports (empty)", empty.status === 200 && empty.body.length === 0);

  const stamp = Date.now();
  const citizenEmail = `smoke.citizen.${stamp}@example.com`;
  const registration = await jsonRequest("POST", "/api/auth/register", {
    name: "Smoke Citizen",
    email: citizenEmail,
    password: "CorrectHorse9!",
    role: "citizen",
  });
  check("POST /api/auth/register", registration.status === 201, `status=${registration.status}`);

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
  check(
    "authority verification",
    staffVerification.status === 200 && staffVerification.body.user.role === "authority",
  );

  const form = new FormData();
  form.set("description", "Pothole on 5th and Main, roughly two feet wide.");
  form.set("district", "North");
  const created = await fetch(`${BASE}/api/reports`, { method: "POST", body: form });
  const createdReport = await created.json();
  check(
    "POST /api/reports responds without waiting for AI triage",
    created.status === 201 && createdReport.analysisStatus === "pending",
    `status=${created.status}`,
  );

  const duplicateStatus = await jsonRequest(
    "PATCH",
    `/api/reports/${createdReport.id}/status`,
    { status: "Resolved" },
  );
  check("status update without token -> 401", duplicateStatus.status === 401);

  const imageForm = new FormData();
  imageForm.set("description", "Broken kerb outside the central library.");
  imageForm.set(
    "image",
    new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")], { type: "image/png" }),
    "kerb.png",
  );
  const imageResponse = await fetch(`${BASE}/api/reports`, {
    method: "POST",
    body: imageForm,
  });
  const imageReport = await imageResponse.json();
  check(
    "image upload stores a host-independent URL",
    imageResponse.status === 201 && String(imageReport.image?.url).startsWith("/uploads/"),
    imageReport.image?.url,
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
    { status: "In Progress" },
    staffToken,
  );
  check(
    "status update as authority",
    statusUpdate.status === 200 && statusUpdate.body.status === "In Progress",
  );

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

  const missingRoute = await jsonRequest("GET", "/api/does-not-exist");
  check("unknown API route -> JSON 404", missingRoute.status === 404 && missingRoute.body.error);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!server.killed) server.kill("SIGKILL");
  await rm(tempDir, { recursive: true, force: true });
}
