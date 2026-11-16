import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { requireAuthority, verifyToken } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import { buildSampleReports } from "./data/sampleReports.js";
import {
  deleteReport,
  confirmReport,
  checkDatabaseConnection,
  getReportById,
  getReports,
  getReportsPage,
  getPendingReportsBefore,
  getReportAudits,
  getReportFieldAudits,
  getReportByTrackingCode,
  saveReport,
  saveReportIfNotDuplicate,
  splitDuplicateReport,
  mergeReports,
  overrideReportTriage,
  updateReport,
  updateReportStatus,
  getUserById,
  getUsers,
  updateUserRole,
  deleteUserById,
  getImpactMetrics,
  getCityHealthMetrics,
} from "./services/db.js";
import { analyzeIssueReport } from "./services/geminiService.js";
import { sanitizeStagedImage } from "./services/imageSanitizer.js";
import { getJwtSecret } from "./services/jwtSecret.js";
import { getPublicSiteUrl } from "./services/siteUrl.js";
import {
  deleteStoredImage,
  checkImageStorageHealth,
  ensureImageStorageReady,
  getImageStorageMode,
  getStoredImageForTriage,
  getUploadsDirectory,
  storeReportImage,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./services/imageStorage.js";
import { getAuthCookie } from "./services/authCookie.js";
import { getRoutingDetails, withSlaState } from "./services/routing.js";
import { cityConfig } from "./services/cityConfig.js";
import { createTriageQueue } from "./services/triageQueue.js";
import { metrics, logStructured } from "./services/observability.js";

const backendDirectory = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: path.join(backendDirectory, ".env") });

const app = express();
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const uploadStagingDirectory = path.join(
  os.tmpdir(),
  `civicguard-upload-staging-${process.pid}`,
);
const UNSUPPORTED_IMAGE_MESSAGE = "Uploaded file must be a JPEG, PNG, or WebP image.";
const distDirectory = path.resolve(backendDirectory, "..", "dist");
const servesStaticBuild =
  process.env.SERVE_STATIC !== "false" && existsSync(path.join(distDirectory, "index.html"));

const analysisTimeoutMs = Number.parseInt(process.env.ANALYSIS_TIMEOUT_MS ?? "180000", 10);
const reportRateLimit = Number.parseInt(process.env.REPORT_RATE_LIMIT ?? "5", 10);
const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;

const trustProxyHops = Number.parseInt(
  process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === "production" ? "1" : "0"),
  10,
);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

const allowedOrigins = [
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.PUBLIC_SITE_URL,
  process.env.RENDER_EXTERNAL_URL,
]
  .flatMap((value) => (value ?? "").split(","))
  .map((value) => originOf(value))
  .filter(Boolean);

const uniqueAllowedOrigins = [...new Set(allowedOrigins)];

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Local images use relative URLs; S3 (or a CDN) needs its origin in the CSP.
const imageOrigins = [
  ...new Set(
    [process.env.S3_PUBLIC_BASE_URL, process.env.API_PUBLIC_BASE_URL]
      .map(originOf)
      .filter(Boolean),
  ),
];

app.use(
  helmet({
    contentSecurityPolicy: servesStaticBuild
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", "data:"],
            imgSrc: [
              "'self'",
              "data:",
              "blob:",
              "https://*.basemaps.cartocdn.com",
              "https://api.maptiler.com",
              ...imageOrigins,
            ],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: null,
          },
        }
      : false,
    crossOriginResourcePolicy: false,
  }),
);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls have no Origin header.
      if (!origin) return callback(null, true);
      return callback(null, uniqueAllowedOrigins.includes(origin.replace(/\/$/, "")));
    },
  }),
);

app.use((_request, response, next) => {
  response.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
  );
  next();
});

app.use((request, response, next) => {
  const start = Date.now();
  request.requestId = randomUUID();
  response.set("x-request-id", request.requestId);
  const cookieToken = getAuthCookie(request);
  if (!request.get("authorization") && cookieToken) {
    request.headers.authorization = `Bearer ${cookieToken}`;
  }
  response.on("finish", () => {
    metrics.recordRequest(request.method, request.path, response.statusCode, Date.now() - start);
  });
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// API responses can contain tokens, reports and user data; never cache them.
app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

if (getImageStorageMode() === "local") {
  app.use("/uploads", express.static(getUploadsDirectory(), { immutable: true, maxAge: "1y" }));
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_request, _file, callback) {
      mkdir(uploadStagingDirectory, { recursive: true })
        .then(() => callback(null, uploadStagingDirectory))
        .catch(callback);
    },
    filename(_request, _file, callback) {
      callback(null, randomUUID());
    },
  }),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter(_request, file, callback) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      callback(new Error(UNSUPPORTED_IMAGE_MESSAGE));
      return;
    }

    callback(null, true);
  },
});

async function removeStagedUpload(file) {
  if (!file?.path) return;
  await unlink(file.path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

const submitReportLimiter = rateLimit({
  windowMs: REPORT_RATE_WINDOW_MS,
  limit: Number.isInteger(reportRateLimit) && reportRateLimit > 0 ? reportRateLimit : 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many reports submitted from this address. Please try again later." },
});

const reportReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many report requests. Please try again later." },
});

const retryTriageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many triage retries. Please try again later." },
});

const trackingLookupLimiter = rateLimit({
  windowMs: REPORT_RATE_WINDOW_MS,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many tracking requests. Please try again later." },
});

const confirmationLimiter = rateLimit({
  windowMs: REPORT_RATE_WINDOW_MS,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many confirmations from this address. Please try again later." },
});

app.get("/api/health", async (request, response) => {
  const [databaseResult, imageStorageResult] = await Promise.allSettled([
    checkDatabaseConnection(),
    checkImageStorageHealth(),
  ]);
  const databaseHealthy =
    databaseResult.status === "fulfilled" && databaseResult.value === true;
  const imageStorageHealthy = imageStorageResult.status === "fulfilled";

  if (!databaseHealthy) {
    console.error(
      `[request ${request.requestId}] Health check: SQLite connectivity failed`,
      databaseResult.status === "rejected" ? databaseResult.reason : undefined,
    );
  }
  if (!imageStorageHealthy) {
    console.error(
      `[request ${request.requestId}] Health check: image storage unavailable`,
      imageStorageResult.status === "rejected" ? imageStorageResult.reason : undefined,
    );
  }

  const status = databaseHealthy && imageStorageHealthy ? "ok" : "degraded";
  response.status(status === "ok" ? 200 : 503).json({
    status,
    uptimeSeconds: Math.round(process.uptime()),
    database: databaseHealthy ? "ok" : "unavailable",
    imageStorage: imageStorageHealthy
      ? imageStorageResult.value
      : { status: "unavailable", mode: getImageStorageMode() },
  });
});

app.get("/api/public-config", (_request, response) => {
  const mapTilerKey = process.env.MAPTILER_API_KEY?.trim();
  response.json({
    mapProvider: mapTilerKey ? "maptiler" : "carto",
    mapTilerKey: mapTilerKey || null,
  });
});

app.get("/api/metrics", (request, response) => {
  const accepts = request.get("accept") ?? "";
  if (accepts.includes("application/json") || request.query.format === "json") {
    response.json(metrics.getSnapshot());
  } else {
    response.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    response.send(metrics.toPrometheusFormat());
  }
});

app.use("/api/auth", authRoutes);

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_TITLE_LENGTH = 120;
const MAX_DISTRICT_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 80;
const TRACKING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function createTrackingCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `CG-${[...randomBytes(5)]
      .map((byte) => TRACKING_ALPHABET[byte % TRACKING_ALPHABET.length])
      .join("")}`;
    if (!(await getReportByTrackingCode(code))) return code;
  }
  throw new Error("Could not allocate a unique report tracking code.");
}

function ruleBasedTriage(description, hasPhoto = false) {
  const text = description.toLowerCase();
  const categoryRules = [
    ["Streetlight", /light|lamp|streetlight|dark street/],
    ["Accessibility", /wheelchair|ramp|sidewalk|accessibility|curb|blind|accessible/],
    ["Garbage", /garbage|trash|waste|dump|rubbish|sanitation/],
    ["Pothole", /pothole|road|street/],
  ];
  const matchingCategory = categoryRules.find(([category, pattern]) =>
    cityConfig.categories.includes(category) && pattern.test(text));
  const category = matchingCategory?.[0] ?? cityConfig.categories[0];
  const highRisk = /injur|accident|danger|blocked|unusable|collapsed|exposed wire/.test(text);
  const severityScore = highRisk ? 5 : /large|deep|broken|overflow|urgent/.test(text) ? 4 : 3;
  const urgencyLevel = severityScore >= 5
    ? "Critical"
    : severityScore === 4
      ? "High"
      : "Medium";
  const riskToVulnerable = /child|children|elderly|older adult|wheelchair|blind|disabilit|school|care home/.test(text) &&
    /danger|injur|blocked|unusable|collapsed|exposed wire|fall|trip|unsafe|risk/.test(text);
  return {
    category,
    severityScore,
    urgencyLevel,
    summary: description.trim().slice(0, 180),
    tags: ["rules-based"],
    confidence: 0.35,
    detectedLanguage: "und",
    translatedDescription: description.trim(),
    photoQuality: hasPhoto ? null : "ok",
    photoMatchesCategory: hasPhoto ? null : true,
    riskToVulnerable,
    riskReason: riskToVulnerable
      ? "The description indicates a safety hazard affecting children, older adults, or people with disabilities."
      : "",
  };
}

function urgencyForSeverity(severityScore) {
  if (severityScore >= 5) return "Critical";
  if (severityScore === 4) return "High";
  if (severityScore === 1) return "Low";
  return "Medium";
}

const triageQueue = createTriageQueue(async (job) => {
  metrics.recordTriageEnqueued();
  try {
    await triageReport(job);
    metrics.recordTriageCompleted();
  } catch (err) {
    metrics.recordTriageFailed(err.code || "error");
    throw err;
  }
});

function open311ServiceCode(category) {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function open311Services() {
  return cityConfig.categories.map((category) => ({
    service_code: open311ServiceCode(category),
    service_name: category,
    description: `Report a ${category.toLowerCase()} issue.`,
    metadata: false,
    type: "realtime",
  }));
}

function toOpen311ServiceRequest(report) {
  const service = open311Services().find(
    (item) => item.service_name.toLowerCase() === String(report.category).toLowerCase(),
  );
  const result = {
    service_request_id: report.trackingCode ?? report.id,
    status: report.status === "Resolved" ? "closed" : "open",
    status_notes: report.afterNote ?? "",
    service_name: service?.service_name ?? report.category,
    service_code: service?.service_code ?? open311ServiceCode(report.category),
    description: report.description ?? "",
    agency_responsible: report.department ?? "",
    requested_datetime: report.timestamp ?? report.createdAt ?? "",
    updated_datetime: report.updatedAt ?? report.triagedAt ?? report.timestamp ?? "",
    address: report.address ?? report.district ?? "",
    zipcode: report.zipcode ?? "",
    media_url: report.image?.url ?? "",
  };
  if (report.location) {
    result.lat = String(report.location.lat);
    result.long = String(report.location.lng);
  }
  if (report.slaDueAt) result.expected_datetime = report.slaDueAt;
  return result;
}

function parseOpen311Date(value, field) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be a valid date.`);
  }
  return Date.parse(value);
}

function open311QueryMatches(report, query, startDate, endDate) {
  const serviceRequestIds = typeof query.service_request_id === "string"
    ? query.service_request_id.split(",").map((id) => id.trim()).filter(Boolean)
    : [];
  if (
    serviceRequestIds.length > 0 &&
    !serviceRequestIds.includes(report.trackingCode) &&
    !serviceRequestIds.includes(report.id)
  ) return false;

  const serviceCodes = typeof query.service_code === "string"
    ? query.service_code.split(",").map((code) => code.trim().toLowerCase()).filter(Boolean)
    : [];
  if (serviceCodes.length > 0 && !serviceCodes.includes(open311ServiceCode(report.category))) {
    return false;
  }
  if (query.status === "open" && report.status === "Resolved") return false;
  if (query.status === "closed" && report.status !== "Resolved") return false;

  const createdAt = Date.parse(report.timestamp ?? report.createdAt ?? "");
  if (startDate !== null && createdAt < startDate) return false;
  if (endDate !== null && createdAt > endDate) return false;
  return true;
}

for (const basePath of ["/open311/v2", "/api/open311/v2"]) {
  app.get(`${basePath}/services.json`, reportReadLimiter, (_request, response) => {
    response.json(open311Services());
  });

  app.get(`${basePath}/requests.json`, reportReadLimiter, async (request, response, next) => {
    try {
      if (request.query.status !== undefined && !["open", "closed"].includes(request.query.status)) {
        response.status(400).json({ error: "status must be open or closed." });
        return;
      }
      const startDate = parseOpen311Date(request.query.start_date, "start_date");
      const endDate = parseOpen311Date(request.query.end_date, "end_date");
      const reports = await getReports();
      response.json(
        reports
          .filter((report) => open311QueryMatches(report, request.query, startDate, endDate))
          .map(toOpen311ServiceRequest),
      );
    } catch (error) {
      if (error instanceof TypeError) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post(`${basePath}/requests.json`, submitReportLimiter, async (request, response, next) => {
    try {
      const { service_code: serviceCode, description } = request.body ?? {};
      const service = open311Services().find((item) => item.service_code === serviceCode);
      if (!service) {
        response.status(400).json({ error: "A valid service_code is required." });
        return;
      }
      if (typeof description !== "string" || !description.trim()) {
        response.status(400).json({ error: "A non-empty description is required." });
        return;
      }
      if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
        response.status(400).json({
          error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        });
        return;
      }
      if (request.body?.media_url) {
        response.status(400).json({ error: "media_url uploads are not supported by this bridge." });
        return;
      }

      const address = typeof request.body?.address === "string" ? request.body.address.trim() : "";
      const parsedLocation = parseReportLocation(
        request.body?.lat,
        request.body?.long ?? request.body?.lon,
      );
      if (parsedLocation.error) {
        response.status(400).json({ error: parsedLocation.error });
        return;
      }
      if (!parsedLocation.location && !address) {
        response.status(400).json({ error: "Provide lat and long, or an address." });
        return;
      }

      const timestamp = new Date().toISOString();
      const reportId = randomUUID();
      const category = service.service_name;
      const zipcode = typeof request.body?.zipcode === "string"
        ? request.body.zipcode.trim().slice(0, 20)
        : "";
      const report = {
        id: reportId,
        timestamp,
        title: provisionalTitle(description.trim()),
        category,
        description: description.trim(),
        analysis: null,
        analysisStatus: "pending",
        status: "Pending",
        district: "Unassigned",
        address: address.slice(0, 100),
        zipcode,
        location: parsedLocation.location,
        image: null,
        trackingCode: await createTrackingCode(),
        reportCount: 1,
        ...getRoutingDetails(category, 3, timestamp),
      };
      const savedReport = await saveReportIfNotDuplicate(
        report,
        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      );
      if (!savedReport.duplicate) {
        triageQueue.enqueue({
          reportId,
          description: description.trim(),
          file: null,
          keepTitle: false,
          keepCategory: true,
        });
      }
      response.status(200).json([toOpen311ServiceRequest(savedReport.report)]);
    } catch (error) {
      next(error);
    }
  });
}

async function sendCriticalAlert(report) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl || report.criticalAlertSentAt) return;

  const location = report.location
    ? `${report.location.lat}, ${report.location.lng}`
    : report.district || "Location not provided";
  const reportUrl = report.trackingCode
    ? new URL(`/track/${encodeURIComponent(report.trackingCode)}`, getPublicSiteUrl()).toString()
    : getPublicSiteUrl();
  const message = [
    "Critical CivicGuard report",
    `Category: ${report.category}`,
    `Summary: ${report.analysis?.summary || report.title}`,
    `Location: ${location}`,
    `Report: ${reportUrl}`,
  ].join("\n");

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}.`);
    const sentAt = new Date().toISOString();
    await updateReport(report.id, { criticalAlertSentAt: sentAt });
    console.info(`[alerts] critical report notification sent for ${report.id}`);
  } catch (error) {
    console.error(`[alerts] critical report notification failed for ${report.id}:`, error.message);
  }
}

function parseReportLocation(latitude, longitude) {
  const hasLatitude =
    latitude !== undefined && latitude !== null && String(latitude).trim() !== "";
  const hasLongitude =
    longitude !== undefined && longitude !== null && String(longitude).trim() !== "";

  if (!hasLatitude && !hasLongitude) return { location: null };
  if (hasLatitude !== hasLongitude) {
    return { error: "Provide both latitude and longitude, or neither." };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Latitude and longitude must be valid numbers." };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "Latitude must be between -90 and 90 and longitude between -180 and 180." };
  }

  return {
    location: {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    },
  };
}

function provisionalTitle(description) {
  const firstLine = description.split(/\r?\n/)[0].trim();
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`AI triage exceeded ${Math.round(timeoutMs / 1000)}s.`);
      error.code = "TRIAGE_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function triageReport({ reportId, description, file, keepTitle, keepCategory }) {
  try {
    const analysis = await withTimeout(
      analyzeIssueReport(description, file, (await getReportById(reportId))?.category ?? null),
      Number.isFinite(analysisTimeoutMs) && analysisTimeoutMs > 0 ? analysisTimeoutMs : 180000,
    );

    const reportBeforeTriage = await getReportById(reportId);
    if (!reportBeforeTriage) throw new Error("Report no longer exists.");
    const timestamp = new Date().toISOString();
    const category = keepCategory ? reportBeforeTriage.category : analysis.category;
    const prioritySeverityScore = Math.min(
      5,
      analysis.severityScore + (analysis.riskToVulnerable ? 1 : 0),
    );
    const priorityUrgencyLevel = urgencyForSeverity(prioritySeverityScore);
    const routing = getRoutingDetails(
      category,
      prioritySeverityScore,
      reportBeforeTriage.timestamp,
    );
    const patch = {
      analysis,
      severityScore: prioritySeverityScore,
      urgencyLevel: priorityUrgencyLevel,
      analysisStatus: "complete",
      triagedAt: timestamp,
      ...routing,
    };
    if (!keepTitle) patch.title = analysis.summary;
    if (!keepCategory) patch.category = analysis.category;

    await updateReport(reportId, patch);
    if (prioritySeverityScore === 5) {
      await sendCriticalAlert({ ...reportBeforeTriage, ...patch });
    }
    console.info(`[triage] completed for report ${reportId} (${analysis.category})`);
  } catch (error) {
    if (error.code === "TRIAGE_TIMEOUT") {
      console.warn(
        `[triage] abandoned report ${reportId} after timeout; the Gemini request may still consume quota.`,
      );
    }
    console.error(`[triage] failed for report ${reportId}:`, error.message);
    try {
      const report = await getReportById(reportId);
      if (!report) throw new Error("Report no longer exists.");
      const analysis = ruleBasedTriage(description, Boolean(file));
      const timestamp = new Date().toISOString();
      const category = keepCategory ? report.category : analysis.category;
      const prioritySeverityScore = Math.min(
        5,
        analysis.severityScore + (analysis.riskToVulnerable ? 1 : 0),
      );
      const priorityUrgencyLevel = urgencyForSeverity(prioritySeverityScore);
      const patch = {
        analysis,
        severityScore: prioritySeverityScore,
        urgencyLevel: priorityUrgencyLevel,
        analysisStatus: "triaged-by-rules",
        analysisError: "Gemini was unavailable; keyword rules supplied a preliminary suggestion.",
        triagedAt: timestamp,
        ...getRoutingDetails(category, prioritySeverityScore, report.timestamp),
        ...(!keepTitle ? { title: analysis.summary } : {}),
        ...(!keepCategory ? { category: analysis.category } : {}),
      };
      await updateReport(reportId, patch);
      if (prioritySeverityScore === 5) {
        await sendCriticalAlert({ ...report, ...patch });
      }
      metrics.recordTriageRulesFallback();
      console.info(`[triage] rules fallback completed for report ${reportId}`);
    } catch (fallbackError) {
      console.error(`[triage] rules fallback failed for report ${reportId}:`, fallbackError);
      try {
        await updateReport(reportId, {
          analysisStatus: "failed",
          analysisError: "Automated triage is temporarily unavailable. Staff will review this report manually.",
        });
      } catch (updateError) {
        console.error(`[triage] could not persist failure for report ${reportId}:`, updateError);
      }
    }
  } finally {
    if (getImageStorageMode() === "s3") {
      await removeStagedUpload(file).catch((cleanupError) => {
        console.error(`[triage] could not remove staged image for report ${reportId}:`, cleanupError);
      });
    }
  }
}

app.post(
  "/api/reports",
  submitReportLimiter,
  upload.single("image"),
  async (request, response, next) => {
    let storedImage = null;
    let reportSaved = false;
    try {
      const description = request.body?.description;
      if (typeof request.body?.website === "string" && request.body.website.trim()) {
        response.status(400).json({ error: "The report could not be accepted." });
        return;
      }

      if (request.file) {
        try {
          await sanitizeStagedImage(request.file);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          response.status(400).json({ error: "Image could not be validated or metadata-stripped." });
          return;
        }
      }
      if (typeof description !== "string" || description.trim().length === 0) {
        response.status(400).json({ error: "A non-empty description is required." });
        return;
      }

      const normalizedDescription = description.trim();
      if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
        response.status(400).json({
          error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        });
        return;
      }

      const selectedCategory =
        typeof request.body?.category === "string" ? request.body.category.trim() : "";
      const customCategory =
        typeof request.body?.customCategory === "string"
          ? request.body.customCategory.trim()
          : "";

      if (selectedCategory === "Other" && customCategory.length < 2) {
        response.status(400).json({ error: "Enter a custom category when selecting Other." });
        return;
      }

      if ((selectedCategory === "Other" ? customCategory : selectedCategory).length > MAX_CATEGORY_LENGTH) {
        response.status(400).json({
          error: `Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`,
        });
        return;
      }

      const providedTitle =
        typeof request.body?.title === "string" && request.body.title.trim()
          ? request.body.title.trim()
          : null;
      if (providedTitle && providedTitle.length > MAX_TITLE_LENGTH) {
        response.status(400).json({
          error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
        });
        return;
      }

      const providedDistrict =
        typeof request.body?.district === "string" && request.body.district.trim()
          ? request.body.district.trim()
          : "Unassigned";
      if (providedDistrict.length > MAX_DISTRICT_LENGTH) {
        response.status(400).json({
          error: `District must be ${MAX_DISTRICT_LENGTH} characters or fewer.`,
        });
        return;
      }

      const providedCategory =
        selectedCategory === "Other" ? customCategory : selectedCategory || null;

      const parsedLocation = parseReportLocation(
        request.body?.latitude,
        request.body?.longitude,
      );
      if (parsedLocation.error) {
        response.status(400).json({ error: parsedLocation.error });
        return;
      }

      const timestamp = new Date().toISOString();
      const reportCategory = providedCategory ?? "Unclassified";
      const duplicateCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const reportId = randomUUID();
      storedImage = request.file
        ? await storeReportImage({ reportId, file: request.file })
        : null;

      const report = {
        id: reportId,
        timestamp,
        title: providedTitle ?? provisionalTitle(normalizedDescription),
        category: reportCategory,
        description: normalizedDescription,
        analysis: null,
        analysisStatus: "pending",
        status: "Pending",
        district: providedDistrict,
        location: parsedLocation.location,
        image: storedImage,
        trackingCode: await createTrackingCode(),
        reportCount: 1,
        ...getRoutingDetails(reportCategory, 3, timestamp),
      };

      const savedReport = await saveReportIfNotDuplicate(report, duplicateCutoff);
      reportSaved = true;

      // Respond immediately; triage continues in the background and updates the record.
      response.status(201).json({
        ...savedReport.report,
        ...(savedReport.duplicate
          ? {
              duplicate: {
                id: savedReport.duplicate.id,
                reportCount: savedReport.duplicate.reportCount,
              },
            }
          : {}),
      });

      if (!savedReport.duplicate) {
        triageQueue.enqueue({
          reportId,
          description: normalizedDescription,
          file: request.file ?? null,
          keepTitle: Boolean(providedTitle),
          keepCategory: Boolean(providedCategory),
        });
      }
    } catch (error) {
      if (storedImage) {
        await deleteStoredImage(storedImage).catch((cleanupError) => {
          console.error("[POST /api/reports] Could not remove unreferenced image:", cleanupError);
        });
      }
      next(error);
    } finally {
      if (!reportSaved) {
        await removeStagedUpload(request.file).catch((cleanupError) => {
          console.error("[POST /api/reports] Could not remove staged upload:", cleanupError);
        });
      }
    }
  },
);

app.get("/api/reports", reportReadLimiter, async (request, response, next) => {
  try {
    const rawLimit = request.query.limit;
    const rawOffset = request.query.offset;
    const requestedLimit = rawLimit === undefined ? 50 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    if (
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      response.status(400).json({ error: "limit must be a positive integer and offset a non-negative integer." });
      return;
    }

    const assignedTo = typeof request.query.assignedTo === "string"
      ? request.query.assignedTo
      : null;
    const limit = Math.min(requestedLimit, 100);
    const page = await getReportsPage(limit, offset, assignedTo);
    response.json({ ...page, data: page.data.map(withSlaState) });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/admin/reports",
  verifyToken,
  requireAuthority,
  reportReadLimiter,
  async (request, response, next) => {
    try {
      const requestedLimit = Number(request.query.limit ?? 100);
      const offset = Number(request.query.offset ?? 0);
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 ||
          !Number.isSafeInteger(offset) || offset < 0) {
        response.status(400).json({ error: "limit and offset must be valid non-negative integers." });
        return;
      }
      const assignedTo = typeof request.query.assignedTo === "string"
        ? request.query.assignedTo
        : null;
      const page = await getReportsPage(Math.min(requestedLimit, 100), offset, assignedTo, true);
      const data = page.data.map(withSlaState);
      response.json({
        ...page,
        data: request.query.overdue === "true"
          ? data.filter((report) => report.overdue)
          : data,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/admin/metrics",
  verifyToken,
  requireAuthority,
  async (_request, response, next) => {
    try {
      response.json(await getImpactMetrics());
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/city-health", reportReadLimiter, async (_request, response, next) => {
  try {
    response.set("Cache-Control", "public, max-age=60").json(await getCityHealthMetrics());
  } catch (error) {
    next(error);
  }
});

app.get("/api/track/:code", trackingLookupLimiter, async (request, response, next) => {
  try {
    const report = await getReportByTrackingCode(request.params.code.trim().toUpperCase());
    if (!report) {
      response.status(404).json({ error: "Tracking code not found." });
      return;
    }
    response.set("Cache-Control", "no-store").json(report);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/reports/:id/confirm",
  confirmationLimiter,
  async (request, response, next) => {
    try {
      const deviceHash = request.body?.deviceHash;
      if (typeof deviceHash !== "string" || !/^[a-f0-9]{64}$/i.test(deviceHash)) {
        response.status(400).json({ error: "A valid device confirmation token is required." });
        return;
      }
      const result = await confirmReport(request.params.id, deviceHash.toLowerCase());
      if (result.error === "not_found") {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      if (result.alreadyConfirmed) {
        response.status(409).json({
          error: "This device has already confirmed this report.",
          ...result,
        });
        return;
      }
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/reports/:id", async (request, response, next) => {
  try {
    const report = await getReportById(request.params.id);
    if (!report) {
      response.status(404).json({ error: "Report not found." });
      return;
    }
    response.json(withSlaState(report));
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/reports/:id/field-audits",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const report = await getReportById(request.params.id);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.json(await getReportFieldAudits(report.id));
    } catch (error) {
      next(error);
    }
  },
);

app.patch(
  "/api/reports/:id/triage-review",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const { category, severityScore } = request.body ?? {};
      if (
        (category !== undefined &&
          (typeof category !== "string" || category.trim().length < 2 || category.trim().length > MAX_CATEGORY_LENGTH)) ||
        (severityScore !== undefined &&
          (!Number.isInteger(severityScore) || severityScore < 1 || severityScore > 5)) ||
        (category === undefined && severityScore === undefined)
      ) {
        response.status(400).json({ error: "Provide a valid category and/or severityScore (1-5)." });
        return;
      }
      const report = await overrideReportTriage(
        request.params.id,
        { category: category?.trim(), severityScore },
        request.user,
      );
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      const updatedReport = await updateReport(
        report.id,
        getRoutingDetails(
          report.category,
          report.analysis?.severityScore ?? report.severityScore ?? 3,
          report.timestamp,
        ),
      );
      response.json(withSlaState(updatedReport));
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/reports/:id/split",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const result = await splitDuplicateReport(request.params.id);
      if (result.error === "not_found") {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      if (result.error) {
        response.status(409).json({ error: "Only a linked duplicate report can be split." });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/reports/:id/merge",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      if (typeof request.body?.targetId !== "string") {
        response.status(400).json({ error: "targetId is required." });
        return;
      }
      const result = await mergeReports(request.body.targetId, request.params.id);
      if (result.error === "not_found") {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      if (result.error) {
        response.status(409).json({ error: "Reports cannot be merged. Choose a different open report of the same category." });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/reports/:id/audits",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const report = await getReportById(request.params.id);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.json(await getReportAudits(report.id));
    } catch (error) {
      next(error);
    }
  },
);

app.patch(
  "/api/reports/:id/assignment",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const assignedTo = request.body?.assignedTo;
      if (assignedTo !== null && typeof assignedTo !== "string") {
        response.status(400).json({ error: "assignedTo must be a user ID or null." });
        return;
      }
      if (assignedTo) {
        const assignee = await getUserById(assignedTo);
        if (!assignee || !assignee.emailVerified || assignee.role !== "authority") {
          response.status(400).json({ error: "Reports can only be assigned to verified authority members." });
          return;
        }
      }
      const report = await getReportById(request.params.id);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.json(await updateReport(report.id, { assignedTo }));
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/reports/:id/triage", retryTriageLimiter, async (request, response, next) => {
  try {
    const report = await getReportById(request.params.id);
    if (!report) {
      response.status(404).json({ error: "Report not found." });
      return;
    }
    if (report.analysisStatus !== "failed") {
      response.status(409).json({ error: "Only reports with failed triage can be retried." });
      return;
    }

    await updateReport(report.id, {
      analysisStatus: "pending",
      analysisError: null,
    });
    response.status(202).json({
      ...report,
      analysisStatus: "pending",
      analysisError: null,
    });

    let file = null;
    try {
      file = await getStoredImageForTriage(report.image);
    } catch (error) {
      console.error(`[triage] Could not load stored image for retry on ${report.id}:`, error);
    }
    triageQueue.enqueue({
      reportId: report.id,
      description: report.description,
      file,
      keepTitle: true,
      keepCategory: true,
    });
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/reports/:id/status",
  verifyToken,
  requireAuthority,
  upload.single("afterPhoto"),
  async (request, response, next) => {
    let storedAfterPhoto = null;
    let afterPhotoMovedToLocalStorage = false;
    try {
      const { status } = request.body ?? {};
      if (!status || !["Pending", "In Progress", "Resolved"].includes(status)) {
        response.status(400).json({
          error: "Status must be Pending, In Progress, or Resolved.",
        });
        return;
      }

      const note = request.body?.note ?? null;
      if (note !== null && (typeof note !== "string" || note.trim().length > 300)) {
        response.status(400).json({ error: "Resolution note must be 300 characters or fewer." });
        return;
      }

      const currentReport = await getReportById(request.params.id);
      if (!currentReport) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      if (request.file && status !== "Resolved") {
        response.status(400).json({ error: "An after photo can only be attached when resolving a report." });
        return;
      }
      if (request.file) {
        try {
          await sanitizeStagedImage(request.file);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          response.status(400).json({ error: "After photo could not be validated or metadata-stripped." });
          return;
        }
        storedAfterPhoto = await storeReportImage({
          reportId: currentReport.id,
          file: request.file,
        });
        afterPhotoMovedToLocalStorage = storedAfterPhoto.storage === "local";
      }

      const report = await updateReportStatus(
        request.params.id,
        status,
        request.user,
        note?.trim() || null,
        status === "Resolved"
          ? {
              ...(storedAfterPhoto ? { afterPhoto: storedAfterPhoto } : {}),
              ...(note?.trim() ? { afterNote: note.trim() } : {}),
            }
          : {},
      );
      if (!report) {
        if (storedAfterPhoto) {
          await deleteStoredImage(storedAfterPhoto);
          storedAfterPhoto = null;
        }
        response.status(404).json({ error: "Report not found." });
        return;
      }

      if (storedAfterPhoto && currentReport.afterPhoto) {
        await deleteStoredImage(currentReport.afterPhoto).catch((imageError) => {
          console.error("[PATCH /api/reports/:id/status] Previous after-photo cleanup failed:", imageError);
        });
      }
      storedAfterPhoto = null;
      response.json(withSlaState(report));
    } catch (error) {
      if (storedAfterPhoto) {
        await deleteStoredImage(storedAfterPhoto).catch((imageError) => {
          console.error("[PATCH /api/reports/:id/status] Could not remove unreferenced after photo:", imageError);
        });
      }
      next(error);
    } finally {
      if (!afterPhotoMovedToLocalStorage) {
        await removeStagedUpload(request.file).catch((cleanupError) => {
          console.error("[PATCH /api/reports/:id/status] Could not remove staged after photo:", cleanupError);
        });
      }
    }
  },
);

app.get("/api/users", verifyToken, requireAuthority, async (_request, response, next) => {
  try {
    response.json(await getUsers());
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/users/:id/role",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const { role } = request.body ?? {};
      if (!["citizen", "authority"].includes(role)) {
        response.status(400).json({ error: "Role must be citizen or authority." });
        return;
      }
      if (request.params.id === request.user.id && role !== "authority") {
        response.status(409).json({ error: "You cannot remove your own authority access." });
        return;
      }
      const result = await updateUserRole(request.params.id, role);
      if (result.error === "not_found") {
        response.status(404).json({ error: "User not found." });
        return;
      }
      if (result.error === "last_authority") {
        response.status(409).json({ error: "The last verified authority member cannot be demoted." });
        return;
      }
      response.json(result.user);
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/users/:id",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      if (request.params.id === request.user.id) {
        response.status(409).json({ error: "You cannot delete your own account while signed in." });
        return;
      }
      const result = await deleteUserById(request.params.id);
      if (result === "not_found") {
        response.status(404).json({ error: "User not found." });
        return;
      }
      if (result === "last_authority") {
        response.status(409).json({ error: "The last verified authority member cannot be deleted." });
        return;
      }
      response.json({ message: "User deleted.", id: request.params.id });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/reports/:id",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const report = await deleteReport(request.params.id);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }

      await deleteStoredImage(report.image).catch((imageError) => {
        console.error("[DELETE /api/reports/:id] Image cleanup failed:", imageError);
      });
      await deleteStoredImage(report.afterPhoto).catch((imageError) => {
        console.error("[DELETE /api/reports/:id] After-photo cleanup failed:", imageError);
      });

      response.json({ message: "Report deleted.", id: report.id });
    } catch (error) {
      next(error);
    }
  },
);

// Unknown API routes must return JSON, never the SPA shell.
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Route not found." });
});

function getSiteOrigin() {
  return getPublicSiteUrl() ?? `http://localhost:${process.env.PORT ?? "5000"}`;
}

app.get("/robots.txt", (_request, response) => {
  response.type("text/plain").send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /uploads/",
      "",
      `Sitemap: ${getSiteOrigin()}/sitemap.xml`,
      "",
    ].join("\n"),
  );
});

app.get("/sitemap.xml", (_request, response) => {
  const origin = getSiteOrigin();
  const xmlEscape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const pages = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/privacy.html", changefreq: "yearly", priority: "0.3" },
    { path: "/terms.html", changefreq: "yearly", priority: "0.3" },
  ];
  const urls = pages
    .map(
      (page) =>
        `  <url><loc>${xmlEscape(`${origin}${page.path}`)}</loc><lastmod>2026-10-25</lastmod><changefreq>${page.changefreq}</changefreq><priority>${page.priority}</priority></url>`,
    )
    .join("\n");

  response.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
});

function loadIndexTemplate() {
  // Re-read on each request so a local rebuild is picked up without a restart;
  // the file is ~2 KB and served with no-cache.
  return readFile(path.join(distDirectory, "index.html"), "utf8");
}

async function sendIndex(_request, response, next) {
  try {
    const template = await loadIndexTemplate();
    const origin = getPublicSiteUrl();
    const html = template.replaceAll("__PUBLIC_ORIGIN__", origin ?? "");
    response.set("Cache-Control", "no-cache").type("html").send(html);
  } catch (error) {
    next(error);
  }
}

if (servesStaticBuild) {
  app.use(
    express.static(distDirectory, {
      index: false,
      maxAge: "1h",
      setHeaders(response, filePath) {
        if (
          filePath.includes(`${path.sep}assets${path.sep}`) ||
          filePath.includes(`${path.sep}fonts${path.sep}`)
        ) {
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith(".html")) {
          response.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get("*", sendIndex);
} else {
  app.use((_request, response) => {
    response.status(404).json({ error: "Route not found." });
  });
}

app.use((error, request, response, _next) => {
  const requestId = request.requestId ?? randomUUID();
  console.error(`[request ${requestId}] CivicGuard request error:`, error);

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    response.status(status).json({
      error: status === 413 ? "Uploaded file is too large." : "Uploaded file could not be accepted.",
      requestId,
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "Request body contains invalid JSON.", requestId });
    return;
  }

  if (error.message === UNSUPPORTED_IMAGE_MESSAGE) {
    response.status(400).json({ error: UNSUPPORTED_IMAGE_MESSAGE, requestId });
    return;
  }

  if (error.expose === true && Number.isInteger(error.statusCode)) {
    response.status(error.statusCode).json({
      error: "The request could not be completed.",
      requestId,
    });
    return;
  }

  const isMissingApiKey =
    typeof error.message === "string" &&
    error.message.includes("GEMINI_API_KEY is not configured");
  const status = isMissingApiKey ? 503 : 500;
  response.status(status).json({ error: "An unexpected server error occurred.", requestId });
});

const port = Number.parseInt(process.env.PORT ?? "5000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

async function seedDemoDataIfRequested() {
  if (process.env.SEED_DEMO_DATA !== "true") return;

  const existingReports = await getReportsPage(1, 0);
  if (existingReports.total > 0) {
    console.log(`[seed] ${existingReports.total} report(s) already present, skipping demo seed.`);
    return;
  }

  const sampleReports = buildSampleReports();
  for (const report of sampleReports) {
    const timestamp = report.timestamp ?? report.createdAt ?? new Date().toISOString();
    const severity = report.analysis?.severityScore ?? report.severityScore ?? 3;
    await saveReport({
      ...report,
      trackingCode: report.trackingCode ?? await createTrackingCode(),
      reportCount: report.reportCount ?? 1,
      ...getRoutingDetails(report.category, severity, timestamp),
    });
  }
  console.log(`[seed] loaded ${sampleReports.length} demo reports (SEED_DEMO_DATA=true).`);
}

async function backfillPilotReportMetadata() {
  const reports = await getReports();
  for (const report of reports) {
    const timestamp = report.timestamp ?? report.createdAt ?? report.created_at;
    const patch = {};
    if (!report.trackingCode) patch.trackingCode = await createTrackingCode();
    if (!Number.isSafeInteger(report.reportCount) || report.reportCount < 1) {
      patch.reportCount = 1;
    }
    if (!report.slaDueAt) {
      Object.assign(
        patch,
        getRoutingDetails(
          report.category,
          report.analysis?.severityScore ?? report.severityScore ?? 3,
          timestamp,
        ),
      );
    }
    if (Object.keys(patch).length > 0) await updateReport(report.id, patch);
  }
}

async function recoverStuckTriage() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const reports = await getPendingReportsBefore(cutoff);
  if (reports.length === 0) return;

  console.info(`[triage] retrying ${reports.length} report(s) pending for more than 10 minutes.`);
  for (const report of reports) {
    let file = null;
    try {
      file = await getStoredImageForTriage(report.image);
    } catch (error) {
      console.error(`[triage] Could not load stored image during recovery for ${report.id}:`, error);
    }
    triageQueue.enqueue({
      reportId: report.id,
      description: report.description,
      file,
      keepTitle: true,
      keepCategory: true,
    });
  }
}

async function startServer() {
  await getJwtSecret();
  await ensureImageStorageReady();
  await seedDemoDataIfRequested();
  await backfillPilotReportMetadata();
  await recoverStuckTriage();

  const server = app.listen(port, () => {
    console.log(`CivicGuard API listening on port ${port}`);
    console.log(
      `Serving ${servesStaticBuild ? `built frontend from ${distDirectory}` : "API only (no dist/ build found)"}`,
    );
    if (!process.env.SMTP_HOST) {
      console.warn(
        "[mail] SMTP is not configured. Verification emails cannot be delivered; registration only works when RETURN_VERIFICATION_LINK allows the link to be shown.",
      );
    }
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  startServer().catch((error) => {
    console.error("CivicGuard failed to start:", error);
    process.exitCode = 1;
  });
}

export { app, startServer };
