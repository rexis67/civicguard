import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
import {
  deleteReport,
  getReportById,
  getReports,
  saveReport,
  updateReport,
  updateReportStatus,
} from "./services/db.js";
import { analyzeIssueReport } from "./services/geminiService.js";
import { getJwtSecret } from "./services/jwtSecret.js";
import {
  deleteStoredImage,
  ensureImageStorageReady,
  getImageStorageMode,
  getUploadsDirectory,
  storeReportImage,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./services/imageStorage.js";

const backendDirectory = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: path.join(backendDirectory, ".env") });

const app = express();
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const UNSUPPORTED_IMAGE_MESSAGE = "Uploaded file must be a PNG, JPEG, WebP, GIF, AVIF, HEIC, or HEIF image.";
const distDirectory = path.resolve(backendDirectory, "..", "dist");
const servesStaticBuild =
  process.env.SERVE_STATIC !== "false" && existsSync(path.join(distDirectory, "index.html"));

const analysisTimeoutMs = Number.parseInt(process.env.ANALYSIS_TIMEOUT_MS ?? "180000", 10);
const reportRateLimit = Number.parseInt(process.env.REPORT_RATE_LIMIT ?? "30", 10);
const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;

const trustProxyHops = Number.parseInt(
  process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === "production" ? "1" : "0"),
  10,
);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: servesStaticBuild
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
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
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls have no Origin header.
      if (!origin || allowedOrigins.length === 0) return callback(null, true);
      return callback(null, allowedOrigins.includes(origin.replace(/\/$/, "")));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

if (getImageStorageMode() === "local") {
  app.use("/uploads", express.static(getUploadsDirectory(), { immutable: true, maxAge: "1y" }));
}

const upload = multer({
  storage: multer.memoryStorage(),
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

const submitReportLimiter = rateLimit({
  windowMs: REPORT_RATE_WINDOW_MS,
  limit: Number.isInteger(reportRateLimit) && reportRateLimit > 0 ? reportRateLimit : 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many reports submitted from this address. Please try again later." },
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    imageStorage: getImageStorageMode(),
    database: process.env.CIVICGUARD_DB_PATH ? "configured" : "default",
  });
});

app.use("/api/auth", authRoutes);

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_TITLE_LENGTH = 120;
const MAX_DISTRICT_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 80;

function provisionalTitle(description) {
  const firstLine = description.split(/\r?\n/)[0].trim();
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AI triage exceeded ${Math.round(timeoutMs / 1000)}s.`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function triageReport({ reportId, description, file, keepTitle, keepCategory }) {
  try {
    const analysis = await withTimeout(
      analyzeIssueReport(description, file),
      Number.isFinite(analysisTimeoutMs) && analysisTimeoutMs > 0 ? analysisTimeoutMs : 180000,
    );

    const patch = {
      analysis,
      analysisStatus: "complete",
      triagedAt: new Date().toISOString(),
    };
    if (!keepTitle) patch.title = analysis.summary;
    if (!keepCategory) patch.category = analysis.category;

    await updateReport(reportId, patch);
    console.info(`[triage] completed for report ${reportId} (${analysis.category})`);
  } catch (error) {
    console.error(`[triage] failed for report ${reportId}:`, error.message);
    await updateReport(reportId, {
      analysisStatus: "failed",
      analysisError: "Automated triage is temporarily unavailable. Staff will review this report manually.",
    }).catch((updateError) => {
      console.error(`[triage] could not persist failure for report ${reportId}:`, updateError);
    });
  }
}

app.post(
  "/api/reports",
  submitReportLimiter,
  upload.single("image"),
  async (request, response, next) => {
    let storedImage = null;
    try {
      const description = request.body?.description;
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

      const reportId = randomUUID();
      storedImage = request.file
        ? await storeReportImage({ reportId, file: request.file })
        : null;

      const report = {
        id: reportId,
        timestamp: new Date().toISOString(),
        title: providedTitle ?? provisionalTitle(normalizedDescription),
        category: providedCategory ?? "Unclassified",
        description: normalizedDescription,
        analysis: null,
        analysisStatus: "pending",
        status: "Pending",
        district: providedDistrict,
        image: storedImage,
      };

      await saveReport(report);

      // Respond immediately; triage continues in the background and updates the record.
      response.status(201).json(report);

      void triageReport({
        reportId,
        description: normalizedDescription,
        file: request.file ?? null,
        keepTitle: Boolean(providedTitle),
        keepCategory: Boolean(providedCategory),
      });
    } catch (error) {
      if (storedImage) {
        await deleteStoredImage(storedImage).catch((cleanupError) => {
          console.error("[POST /api/reports] Could not remove unreferenced image:", cleanupError);
        });
      }
      next(error);
    }
  },
);

app.get("/api/reports", async (_request, response, next) => {
  try {
    response.json(await getReports());
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports/:id", async (request, response, next) => {
  try {
    const report = await getReportById(request.params.id);
    if (!report) {
      response.status(404).json({ error: "Report not found." });
      return;
    }
    response.json(report);
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/reports/:id/status",
  verifyToken,
  requireAuthority,
  async (request, response, next) => {
    try {
      const { status } = request.body ?? {};
      if (!status || !["Pending", "In Progress", "Resolved"].includes(status)) {
        response.status(400).json({
          error: "Status must be Pending, In Progress, or Resolved.",
        });
        return;
      }

      const report = await updateReportStatus(request.params.id, status);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }

      response.json(report);
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

if (servesStaticBuild) {
  app.use(express.static(distDirectory, { index: false, maxAge: "1h" }));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distDirectory, "index.html"));
  });
} else {
  app.use((_request, response) => {
    response.status(404).json({ error: "Route not found." });
  });
}

app.use((error, _request, response, _next) => {
  console.error("CivicGuard request error:", error);

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    response.status(status).json({ error: error.message });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "Request body contains invalid JSON." });
    return;
  }

  if (error.message === UNSUPPORTED_IMAGE_MESSAGE) {
    response.status(400).json({ error: error.message });
    return;
  }

  // Deliberate, safe-to-expose configuration errors (e.g. missing SMTP).
  if (error.expose === true && Number.isInteger(error.statusCode)) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  const isMissingApiKey =
    typeof error.message === "string" &&
    error.message.includes("GEMINI_API_KEY is not configured");
  const status = isMissingApiKey ? 503 : 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected server error occurred."
      : error.message || "An unexpected server error occurred.";

  response.status(status).json({ error: message });
});

const port = Number.parseInt(process.env.PORT ?? "5000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

async function startServer() {
  await getReports();
  await getJwtSecret();
  await ensureImageStorageReady();

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
