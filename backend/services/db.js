import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const legacyReportsFile = resolve(
  process.env.CIVICGUARD_REPORTS_PATH ?? fileURLToPath(new URL("../reports.json", import.meta.url)),
);
const usersFile = resolve(
  process.env.CIVICGUARD_LEGACY_USERS_PATH ?? fileURLToPath(new URL("../users.json", import.meta.url)),
);
const migratedUsersFile = `${usersFile}.migrated`;
const databaseFile = resolve(
  process.env.DB_PATH ??
    process.env.CIVICGUARD_DB_PATH ??
    resolve(process.cwd(), "data", "civicguard.db"),
);

await mkdir(dirname(databaseFile), { recursive: true });
const database = new Database(databaseFile);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('citizen', 'authority')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_token_hash TEXT,
    verification_token_expires_at INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS users_verification_token_hash_idx
    ON users (verification_token_hash);
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_reset_token_hash_idx
    ON password_reset_tokens (token_hash);
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    category TEXT NOT NULL COLLATE NOCASE,
    latitude REAL,
    longitude REAL,
    analysis_status TEXT,
    assigned_to TEXT REFERENCES users (id) ON DELETE SET NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports (created_at DESC);
  CREATE INDEX IF NOT EXISTS reports_duplicate_lookup_idx
    ON reports (category, created_at, latitude, longitude);
  CREATE INDEX IF NOT EXISTS reports_pending_triage_idx
    ON reports (analysis_status, created_at);
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS report_audits (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS report_audits_report_created_idx
    ON report_audits (report_id, created_at DESC);
`);

const reportColumnsInDatabase = new Set(
  database.pragma("table_info(reports)").map((column) => column.name),
);
if (!reportColumnsInDatabase.has("assigned_to")) {
  database.exec("ALTER TABLE reports ADD COLUMN assigned_to TEXT REFERENCES users (id) ON DELETE SET NULL");
}

const pilotMigration = database.transaction(() => {
  const columns = new Set(database.pragma("table_info(reports)").map((column) => column.name));
  if (!columns.has("duplicate_of")) database.exec("ALTER TABLE reports ADD COLUMN duplicate_of TEXT");
  if (!columns.has("report_count")) {
    database.exec("ALTER TABLE reports ADD COLUMN report_count INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.has("tracking_code")) database.exec("ALTER TABLE reports ADD COLUMN tracking_code TEXT");

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS reports_tracking_code_idx
      ON reports (tracking_code) WHERE tracking_code IS NOT NULL;
    CREATE INDEX IF NOT EXISTS reports_duplicate_of_idx ON reports (duplicate_of);
    CREATE TABLE IF NOT EXISTS report_timeline (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS report_timeline_report_created_idx
      ON report_timeline (report_id, created_at, id);
    CREATE TABLE IF NOT EXISTS report_field_audits (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      field TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS report_field_audits_report_created_idx
      ON report_field_audits (report_id, created_at DESC);
  `);
  database.prepare(
    "INSERT INTO schema_migrations (name, completed_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
  ).run("pilot-tracking-duplicates-and-audits-v1", new Date().toISOString());
});
pilotMigration();

const communityConfirmationsMigration = database.transaction(() => {
  const columns = new Set(database.pragma("table_info(reports)").map((column) => column.name));
  if (!columns.has("confirmation_count")) {
    database.exec("ALTER TABLE reports ADD COLUMN confirmation_count INTEGER NOT NULL DEFAULT 0");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS community_confirmations (
      report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
      device_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (report_id, device_hash)
    );
    CREATE INDEX IF NOT EXISTS community_confirmations_created_idx
      ON community_confirmations (created_at);
  `);
  database.prepare(
    "INSERT INTO schema_migrations (name, completed_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
  ).run("community-confirmations-v1", new Date().toISOString());
});
communityConfirmationsMigration();

function mapReportRow(row) {
  const report = JSON.parse(row.payload);
  if (row.assigned_to !== undefined) report.assignedTo = row.assigned_to;
  else report.assignedTo ??= null;
  if (row.duplicate_of !== undefined) report.duplicateOf = row.duplicate_of;
  if (row.report_count !== undefined) report.reportCount = row.report_count;
  if (row.confirmation_count !== undefined) report.confirmationCount = row.confirmation_count;
  if (row.tracking_code !== undefined) report.trackingCode = row.tracking_code;
  return report;
}

function reportColumns(report) {
  const timestamp = report.timestamp ?? report.createdAt ?? report.created_at;
  const latitude = Number(report.location?.lat ?? report.latitude);
  const longitude = Number(report.location?.lng ?? report.longitude);
  try {
    return {
      id: report.id,
      createdAt: typeof timestamp === "string" ? timestamp : new Date().toISOString(),
      category: String(report.category ?? "Unclassified"),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      analysisStatus: typeof report.analysisStatus === "string" ? report.analysisStatus : null,
      assignedTo: typeof report.assignedTo === "string" ? report.assignedTo : null,
      duplicateOf: typeof report.duplicateOf === "string" ? report.duplicateOf : null,
      reportCount: Number.isSafeInteger(report.reportCount) && report.reportCount > 0
        ? report.reportCount
        : 1,
      confirmationCount: Number.isSafeInteger(report.confirmationCount) && report.confirmationCount > 0
        ? report.confirmationCount
        : 0,
      trackingCode: typeof report.trackingCode === "string" ? report.trackingCode : null,
      payload: JSON.stringify(report),
    };
  } catch (error) {
    throw new TypeError("Report data could not be serialized.", { cause: error });
  }
}

async function migrateLegacyReports() {
  const alreadyMigrated = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE name = ?",
  ).get("reports-json-to-sqlite");
  if (alreadyMigrated) return;

  let fileContents;
  try {
    fileContents = await readFile(legacyReportsFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fileContents = null;
  }

  let savedReports = [];
  if (fileContents !== null) {
    try {
      savedReports = JSON.parse(fileContents);
    } catch (error) {
      console.warn(`[db] Could not parse legacy report store ${legacyReportsFile}:`, error);
    }
    if (!Array.isArray(savedReports)) {
      console.warn(`[db] Legacy report store ${legacyReportsFile} did not contain a JSON array.`);
      savedReports = [];
    }
  }

  const insertReport = database.prepare(`
    INSERT OR IGNORE INTO reports (
      id, created_at, category, latitude, longitude, analysis_status, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const markMigration = database.prepare(`
    INSERT INTO schema_migrations (name, completed_at) VALUES (?, ?)
  `);
  const migrate = database.transaction((records) => {
    for (const report of records) {
      if (!report || typeof report !== "object" || Array.isArray(report) || typeof report.id !== "string") {
        continue;
      }
      const columns = reportColumns(report);
      insertReport.run(
        columns.id,
        columns.createdAt,
        columns.category,
        columns.latitude,
        columns.longitude,
        columns.analysisStatus,
        columns.payload,
      );
    }
    markMigration.run("reports-json-to-sqlite", new Date().toISOString());
  });
  migrate(savedReports);
}

async function migrateLegacyUsers() {
  let fileContents;
  try {
    fileContents = await readFile(usersFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const legacyUsers = JSON.parse(fileContents);
  if (!Array.isArray(legacyUsers)) {
    throw new TypeError("Legacy backend/users.json must contain a JSON array.");
  }

  const insertLegacyUser = database.prepare(`
    INSERT OR IGNORE INTO users (
      id, name, email, password_hash, role, email_verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const migrate = database.transaction((records) => {
    for (const user of records) {
      if (
        typeof user?.id !== "string" ||
        typeof user?.name !== "string" ||
        typeof user?.email !== "string" ||
        typeof user?.passwordHash !== "string" ||
        !["citizen", "authority"].includes(user.role)
      ) {
        continue;
      }

      insertLegacyUser.run(
        user.id,
        user.name,
        user.email.trim().toLowerCase(),
        user.passwordHash,
        user.role,
        user.emailVerified === true ? 1 : 0,
        user.createdAt ?? new Date().toISOString(),
      );
    }
  });

  migrate(legacyUsers);
  await rename(usersFile, migratedUsersFile).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
    await unlink(usersFile);
  });
}

await Promise.all([migrateLegacyReports(), migrateLegacyUsers()]);

function clone(value) {
  return structuredClone(value);
}

function addTimelineEvent(reportId, status, note = null, createdAt = new Date().toISOString()) {
  database.prepare(`
    INSERT INTO report_timeline (id, report_id, status, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), reportId, status, note, createdAt);
}

function persistReportColumns(columns) {
  database.prepare(`
    UPDATE reports
    SET created_at = ?, category = ?, latitude = ?, longitude = ?,
        analysis_status = ?, assigned_to = ?, payload = ?, duplicate_of = ?,
        report_count = ?, tracking_code = ?, confirmation_count = ?
    WHERE id = ?
  `).run(
    columns.createdAt,
    columns.category,
    columns.latitude,
    columns.longitude,
    columns.analysisStatus,
    columns.assignedTo,
    columns.payload,
    columns.duplicateOf,
    columns.reportCount,
    columns.trackingCode,
    columns.confirmationCount,
    columns.id,
  );
}

export async function getReports() {
  return database.prepare("SELECT * FROM reports ORDER BY created_at DESC, id DESC")
    .all().map(mapReportRow);
}

export async function checkDatabaseConnection() {
  return database.prepare("SELECT 1 AS result").get().result === 1;
}

export async function getReportsPage(limit = 50, offset = 0, assignedTo = null, includeDuplicates = false) {
  const clauses = [];
  const parameters = [];
  if (!includeDuplicates) clauses.push("duplicate_of IS NULL");
  if (assignedTo === "unassigned") clauses.push("assigned_to IS NULL");
  else if (assignedTo !== null) {
    clauses.push("assigned_to = ?");
    parameters.push(assignedTo);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = database.prepare(`SELECT COUNT(*) AS count FROM reports ${where}`)
    .get(...parameters).count;
  const data = database.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset).map(mapReportRow);
  return { total, limit, offset, data };
}

export async function getPendingReportsBefore(timestamp) {
  return database.prepare(`
    SELECT * FROM reports
    WHERE analysis_status = 'pending' AND created_at < ?
    ORDER BY created_at ASC
  `).all(timestamp).map(mapReportRow);
}

function findDuplicateReportSync(category, location, createdAfter) {
  if (!location) return null;

  const latitudeDelta = 50 / 111_320;
  const longitudeScale = Math.cos((location.lat * Math.PI) / 180);
  const longitudeDelta = Math.abs(longitudeScale) < 0.000001
    ? 180
    : Math.min(180, 50 / (111_320 * Math.abs(longitudeScale)));
  const candidates = database.prepare(`
    SELECT * FROM reports
    WHERE category = ?
      AND created_at >= ?
      AND duplicate_of IS NULL
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
  `).all(
    category,
    createdAfter,
    Math.max(-90, location.lat - latitudeDelta),
    Math.min(90, location.lat + latitudeDelta),
    Math.max(-180, location.lng - longitudeDelta),
    Math.min(180, location.lng + longitudeDelta),
  );

  const radians = (degrees) => (degrees * Math.PI) / 180;
  for (const candidate of candidates) {
    const report = mapReportRow(candidate);
    if (report.status === "Resolved") continue;
    const candidateLatitude = Number(report.location?.lat ?? report.latitude);
    const candidateLongitude = Number(report.location?.lng ?? report.longitude);
    const latitudeDifference = radians(candidateLatitude - location.lat);
    const longitudeDifference = radians(candidateLongitude - location.lng);
    const haversine =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(radians(location.lat)) *
        Math.cos(radians(candidateLatitude)) *
        Math.sin(longitudeDifference / 2) ** 2;
    const distanceMeters =
      6_371_000 *
      2 *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
    if (distanceMeters <= 50) return report;
  }
  return null;
}

export async function findDuplicateReport(category, location, createdAfter) {
  return findDuplicateReportSync(category, location, createdAfter);
}

export async function saveReportIfNotDuplicate(report, createdAfter) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("A report object is required.");
  }
  if (typeof report.id !== "string" || !report.id.trim()) {
    throw new TypeError("A report ID is required.");
  }

  const reportToSave = clone(report);
  const columns = reportColumns(reportToSave);
  const save = database.transaction(() => {
    const duplicate = findDuplicateReportSync(
      columns.category,
      reportToSave.location ?? null,
      createdAfter,
    );
    if (duplicate) {
      const currentCount = Number(duplicate.reportCount) || 1;
      const updatedCount = currentCount + 1;
      const duplicateReport = {
        ...reportToSave,
        duplicateOf: duplicate.id,
        reportCount: 1,
        status: duplicate.status,
        analysis: duplicate.analysis ?? null,
        analysisStatus: duplicate.analysisStatus ?? "complete",
      };
      const updatedParent = {
        ...duplicate,
        reportCount: updatedCount,
      };
      const currentSeverity = Number(
        duplicate.analysis?.severityScore ?? duplicate.severityScore ?? 3,
      );
      if (Number.isFinite(currentSeverity)) {
        const raisedSeverity = Math.min(5, currentSeverity + 1);
        if (duplicate.analysis) {
          updatedParent.analysis = { ...duplicate.analysis, severityScore: raisedSeverity };
        }
        updatedParent.severityScore = raisedSeverity;
        updatedParent.urgencyLevel = raisedSeverity >= 5
          ? "Critical"
          : raisedSeverity >= 4
            ? "High"
            : raisedSeverity >= 3
              ? "Medium"
              : "Low";
      }

      const duplicateColumns = reportColumns(duplicateReport);
      const parentColumns = reportColumns(updatedParent);
      database.prepare(`
        INSERT INTO reports (
          id, created_at, category, latitude, longitude, analysis_status, assigned_to,
          payload, duplicate_of, report_count, tracking_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        duplicateColumns.id,
        duplicateColumns.createdAt,
        duplicateColumns.category,
        duplicateColumns.latitude,
        duplicateColumns.longitude,
        duplicateColumns.analysisStatus,
        duplicateColumns.assignedTo,
        duplicateColumns.payload,
        duplicateColumns.duplicateOf,
        duplicateColumns.reportCount,
        duplicateColumns.trackingCode,
      );
      database.prepare(`
        UPDATE reports SET payload = ?, report_count = ? WHERE id = ?
      `).run(parentColumns.payload, updatedCount, duplicate.id);
      addTimelineEvent(duplicateReport.id, "Received", null, duplicateReport.timestamp);
      addTimelineEvent(
        duplicateReport.id,
        duplicateReport.status,
        "Linked to a similar open report.",
        duplicateReport.timestamp,
      );
      return { duplicate: updatedParent, report: duplicateReport };
    }

    database.prepare(`
      INSERT INTO reports (
        id, created_at, category, latitude, longitude, analysis_status, assigned_to,
        payload, duplicate_of, report_count, tracking_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      columns.id,
      columns.createdAt,
      columns.category,
      columns.latitude,
      columns.longitude,
      columns.analysisStatus,
      columns.assignedTo,
      columns.payload,
      columns.duplicateOf,
      columns.reportCount,
      columns.trackingCode,
    );
    addTimelineEvent(reportToSave.id, "Received", null, columns.createdAt);
    return { duplicate: null, report: reportToSave };
  });
  return save();
}

export async function getUserByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const row = database.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  return row ? mapUser(row) : null;
}

export async function getUserById(id) {
  const row = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? mapUser(row) : null;
}

export async function getUsers() {
  return database.prepare(`
    SELECT id, name, email, role, email_verified, created_at
    FROM users ORDER BY created_at DESC, id
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    emailVerified: row.email_verified === 1,
    createdAt: row.created_at,
  }));
}

export async function updateUserRole(id, role) {
  const update = database.transaction(() => {
    const user = database.prepare("SELECT id, role, email_verified FROM users WHERE id = ?").get(id);
    if (!user) return { error: "not_found" };
    if (
      user.role === "authority" &&
      role !== "authority" &&
      user.email_verified === 1
    ) {
      const authorityCount = database.prepare(`
        SELECT COUNT(*) AS count FROM users
        WHERE role = 'authority' AND email_verified = 1
      `).get().count;
      if (authorityCount <= 1) return { error: "last_authority" };
    }
    database.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    if (role !== "authority") {
      database.prepare("UPDATE reports SET assigned_to = NULL WHERE assigned_to = ?").run(id);
    }
    return { user: database.prepare(`
      SELECT id, name, email, role, email_verified, created_at FROM users WHERE id = ?
    `).get(id) };
  });
  const result = update();
  if (result.error) return result;
  const row = result.user;
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      emailVerified: row.email_verified === 1,
      createdAt: row.created_at,
    },
  };
}

export async function deleteUserById(id) {
  const remove = database.transaction(() => {
    const user = database.prepare("SELECT id, role, email_verified FROM users WHERE id = ?").get(id);
    if (!user) return "not_found";
    if (user.role === "authority" && user.email_verified === 1) {
      const authorityCount = database.prepare(`
        SELECT COUNT(*) AS count FROM users
        WHERE role = 'authority' AND email_verified = 1
      `).get().count;
      if (authorityCount <= 1) return "last_authority";
    }
    database.prepare("DELETE FROM users WHERE id = ?").run(id);
    return "deleted";
  });
  return remove();
}

export async function saveUser(newUserData) {
  if (!newUserData || typeof newUserData !== "object" || Array.isArray(newUserData)) {
    throw new TypeError("A user object is required.");
  }

  const userToSave = clone(newUserData);
  if (typeof userToSave.email !== "string" || !userToSave.email.trim()) {
    throw new TypeError("A user email is required.");
  }
  userToSave.email = userToSave.email.trim().toLowerCase();

  try {
    database.prepare(`
      INSERT INTO users (
        id, name, email, password_hash, role, email_verified,
        verification_token_hash, verification_token_expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userToSave.id,
      userToSave.name,
      userToSave.email,
      userToSave.passwordHash,
      userToSave.role,
      userToSave.emailVerified ? 1 : 0,
      userToSave.verificationTokenHash ?? null,
      userToSave.verificationTokenExpiresAt ?? null,
      userToSave.createdAt ?? new Date().toISOString(),
    );
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT_UNIQUE")) {
      const duplicate = new Error("An account with this email already exists.");
      duplicate.code = "DUPLICATE_EMAIL";
      throw duplicate;
    }
    throw error;
  }

  return getUserByEmail(userToSave.email);
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    emailVerified: row.email_verified === 1,
    verificationTokenHash: row.verification_token_hash,
    verificationTokenExpiresAt: row.verification_token_expires_at,
    createdAt: row.created_at,
  };
}

export async function setEmailVerification(id, tokenHash, expiresAt) {
  database.prepare(`
    UPDATE users
    SET verification_token_hash = ?, verification_token_expires_at = ?
    WHERE id = ? AND email_verified = 0
  `).run(tokenHash, expiresAt, id);
}

export async function verifyUserEmail(tokenHash, now = Date.now()) {
  const verify = database.transaction(() => {
    const row = database.prepare(`
      SELECT * FROM users
      WHERE verification_token_hash = ?
        AND verification_token_expires_at > ?
        AND email_verified = 0
    `).get(tokenHash, now);

    if (!row) return null;
    database.prepare(`
      UPDATE users
      SET email_verified = 1,
          verification_token_hash = NULL,
          verification_token_expires_at = NULL
      WHERE id = ?
    `).run(row.id);
    return database.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
  });

  const row = verify();
  return row ? mapUser(row) : null;
}

export async function savePasswordResetToken(userId, tokenHash, expiresAt) {
  database.prepare(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at
  `).run(userId, tokenHash, expiresAt);
}

export async function resetPasswordWithToken(tokenHash, passwordHash, now = Date.now()) {
  const reset = database.transaction(() => {
    const token = database.prepare(`
      SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash, now);
    if (!token) return false;

    const result = database.prepare(`
      UPDATE users SET password_hash = ? WHERE id = ?
    `).run(passwordHash, token.user_id);
    if (result.changes === 0) return false;

    database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(token.user_id);
    return true;
  });

  return reset();
}

export async function updateEmailVerification(id, tokenHash, expiresAt) {
  const result = database.prepare(`
    UPDATE users
    SET verification_token_hash = ?, verification_token_expires_at = ?
    WHERE id = ? AND email_verified = 0
  `).run(tokenHash, expiresAt, id);
  if (result.changes === 0) return null;
  const row = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? mapUser(row) : null;
}

export async function deleteUnverifiedUser(id) {
  database.prepare("DELETE FROM users WHERE id = ? AND email_verified = 0").run(id);
}

export async function getReportById(id) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }

  const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  return row ? mapReportRow(row) : null;
}

export async function getReportByTrackingCode(trackingCode) {
  const row = database.prepare(
    "SELECT * FROM reports WHERE tracking_code = ? COLLATE NOCASE",
  ).get(trackingCode);
  if (!row) return null;
  const report = mapReportRow(row);
  const canonicalId = report.duplicateOf ?? report.id;
  const canonicalRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(canonicalId);
  if (!canonicalRow) return null;
  const canonical = mapReportRow(canonicalRow);
  const timeline = database.prepare(`
    SELECT status, note, created_at AS createdAt
    FROM report_timeline
    WHERE report_id = ? OR report_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(report.id, canonicalId).map((event) => ({
    status: event.status,
    note: event.note,
    createdAt: event.createdAt,
  }));
  return {
    reportId: canonical.id,
    title: canonical.title,
    category: canonical.category,
    location: canonical.location ?? null,
    image: canonical.image ?? null,
    afterPhoto: canonical.afterPhoto ?? null,
    afterNote: canonical.afterNote ?? null,
    reportCount: canonical.reportCount,
    confirmationCount: canonical.confirmationCount ?? 0,
    trackingCode: report.trackingCode,
    status: canonical.status,
    timeline,
  };
}

export async function confirmReport(reportId, deviceHash) {
  const confirm = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
    if (!row) return { error: "not_found" };
    const requestedReport = mapReportRow(row);
    const canonicalId = requestedReport.duplicateOf ?? requestedReport.id;
    const canonicalRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(canonicalId);
    if (!canonicalRow) return { error: "not_found" };
    const report = mapReportRow(canonicalRow);
    const now = new Date().toISOString();
    const inserted = database.prepare(`
      INSERT OR IGNORE INTO community_confirmations (report_id, device_hash, created_at)
      VALUES (?, ?, ?)
    `).run(canonicalId, deviceHash, now);
    if (inserted.changes === 0) {
      return {
        alreadyConfirmed: true,
        reportCount: report.reportCount,
        confirmationCount: report.confirmationCount ?? 0,
        urgencyLevel: report.urgencyLevel ?? report.urgency,
      };
    }

    const previousCount = Number(report.reportCount) || 1;
    const reportCount = previousCount + 1;
    const confirmationCount = (Number(report.confirmationCount) || 0) + 1;
    const urgencyLevels = ["Low", "Medium", "High", "Critical"];
    const urgency = String(report.urgencyLevel ?? report.urgency ?? "Low");
    const urgencyIndex = urgencyLevels.findIndex(
      (level) => level.toLowerCase() === urgency.toLowerCase(),
    );
    const priorityThresholds = [5, 10, 20, 50];
    const thresholdCrossed = priorityThresholds.some(
      (threshold) => previousCount < threshold && reportCount >= threshold,
    );
    if (thresholdCrossed && urgencyIndex >= 0 && urgencyIndex < urgencyLevels.length - 1) {
      report.urgencyLevel = urgencyLevels[urgencyIndex + 1];
    }
    report.reportCount = reportCount;
    report.confirmationCount = confirmationCount;
    persistReportColumns(reportColumns(report));
    return {
      alreadyConfirmed: false,
      reportCount,
      confirmationCount,
      urgencyLevel: report.urgencyLevel ?? urgency,
    };
  });
  return confirm();
}

export async function saveReport(newReportData) {
  if (!newReportData || typeof newReportData !== "object" || Array.isArray(newReportData)) {
    throw new TypeError("A report object is required.");
  }

  if (typeof newReportData.id !== "string" || !newReportData.id.trim()) {
    throw new TypeError("A report ID is required.");
  }

  const reportToSave = clone(newReportData);
  const columns = reportColumns(reportToSave);
  database.prepare(`
    INSERT INTO reports (
      id, created_at, category, latitude, longitude, analysis_status, assigned_to,
      payload, duplicate_of, report_count, tracking_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    columns.id,
    columns.createdAt,
    columns.category,
    columns.latitude,
    columns.longitude,
    columns.analysisStatus,
    columns.assignedTo,
    columns.payload,
    columns.duplicateOf,
    columns.reportCount,
    columns.trackingCode,
  );
  if (reportToSave.trackingCode) {
    addTimelineEvent(reportToSave.id, "Received", null, columns.createdAt);
    if (reportToSave.analysisStatus === "complete" || reportToSave.analysisStatus === "triaged-by-rules") {
      addTimelineEvent(reportToSave.id, "Triaged", null, reportToSave.triagedAt ?? columns.createdAt);
    }
    if (reportToSave.status && reportToSave.status !== "Pending") {
      addTimelineEvent(reportToSave.id, reportToSave.status, null, columns.createdAt);
    }
  }
  return clone(reportToSave);
}

export async function replaceReports(reportsToSave) {
  if (!Array.isArray(reportsToSave)) {
    throw new TypeError("A list of reports is required.");
  }

  const rows = reportsToSave.map((report) => {
    if (!report || typeof report !== "object" || Array.isArray(report) || typeof report.id !== "string") {
      throw new TypeError("Every report must be an object with an ID.");
    }
    return reportColumns(clone(report));
  });
  const replace = database.transaction((records) => {
    database.prepare("DELETE FROM reports").run();
    const insert = database.prepare(`
      INSERT INTO reports (
        id, created_at, category, latitude, longitude, analysis_status, assigned_to,
        payload, duplicate_of, report_count, tracking_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of records) {
      insert.run(
        row.id,
        row.createdAt,
        row.category,
        row.latitude,
        row.longitude,
        row.analysisStatus,
        row.assignedTo,
        row.payload,
        row.duplicateOf,
        row.reportCount,
        row.trackingCode,
      );
    }
  });
  replace(rows);
  return rows.length;
}

export async function updateReport(id, patch) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("A patch object is required.");
  }

  const update = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    if (!row) return null;

    const previous = mapReportRow(row);
    const updatedReport = { ...previous, ...clone(patch) };
    const columns = reportColumns(updatedReport);
    persistReportColumns(columns);
    if (
      previous.analysisStatus === "pending" &&
      ["complete", "triaged-by-rules"].includes(updatedReport.analysisStatus)
    ) {
      addTimelineEvent(
        id,
        "Triaged",
        updatedReport.analysisStatus === "triaged-by-rules" ? "Triaged by rules" : null,
        updatedReport.triagedAt ?? new Date().toISOString(),
      );
    }
    if (!previous.trackingCode && updatedReport.trackingCode) {
      addTimelineEvent(id, "Received", null, columns.createdAt);
      if (["complete", "triaged-by-rules"].includes(updatedReport.analysisStatus)) {
        addTimelineEvent(
          id,
          "Triaged",
          updatedReport.analysisStatus === "triaged-by-rules" ? "Triaged by rules" : null,
          updatedReport.triagedAt ?? columns.createdAt,
        );
      }
      if (updatedReport.status && updatedReport.status !== "Pending") {
        addTimelineEvent(id, updatedReport.status, null, columns.createdAt);
      }
    }
    return updatedReport;
  });

  const updated = update();
  return updated ? clone(updated) : null;
}

export async function updateReportStatus(id, status, actor = null, note = null, proof = {}) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }
  if (typeof status !== "string" || !status.trim()) {
    throw new TypeError("A non-empty report status is required.");
  }

  const update = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    if (!row) return null;

    const previous = mapReportRow(row);
    const updatedReport = { ...previous, ...clone(proof), status: status.trim() };
    const columns = reportColumns(updatedReport);
    persistReportColumns(columns);
    if (previous.status !== updatedReport.status) {
      addTimelineEvent(id, updatedReport.status, note, new Date().toISOString());
    }
    if (actor?.id && actor?.email) {
      database.prepare(`
        INSERT INTO report_audits (
          id, report_id, actor_id, actor_email, previous_status, new_status, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        id,
        actor.id,
        actor.email,
        previous.status ?? null,
        updatedReport.status,
        note,
        new Date().toISOString(),
      );
    }
    return updatedReport;
  });
  const updated = update();
  return updated ? clone(updated) : null;
}

export async function getReportAudits(reportId) {
  return database.prepare(`
    SELECT id, report_id AS reportId, actor_id AS actorId, actor_email AS actorEmail,
      previous_status AS previousStatus, new_status AS newStatus, note, created_at AS createdAt
    FROM report_audits WHERE report_id = ? ORDER BY created_at DESC, id DESC
  `).all(reportId);
}

export async function getReportFieldAudits(reportId) {
  return database.prepare(`
    SELECT id, report_id AS reportId, field, actor_id AS actorId,
      actor_email AS actorEmail, old_value AS oldValue, new_value AS newValue,
      created_at AS createdAt
    FROM report_field_audits WHERE report_id = ? ORDER BY created_at DESC, id DESC
  `).all(reportId);
}

export async function overrideReportTriage(id, patch, actor) {
  const update = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    if (!row) return null;
    const previous = mapReportRow(row);
    const analysis = { ...(previous.analysis ?? {}) };
    const fields = [];
    if (typeof patch.category === "string" && patch.category !== previous.category) {
      fields.push(["category", previous.category, patch.category]);
      previous.category = patch.category;
      analysis.category = patch.category;
    }
    if (
      Number.isInteger(patch.severityScore) &&
      patch.severityScore >= 1 &&
      patch.severityScore <= 5 &&
      patch.severityScore !== (analysis.severityScore ?? previous.severityScore)
    ) {
      fields.push([
        "severityScore",
        analysis.severityScore ?? previous.severityScore,
        patch.severityScore,
      ]);
      analysis.severityScore = patch.severityScore;
      previous.severityScore = patch.severityScore;
    }
    if (fields.length === 0) return previous;
    previous.triageSuggestion ??= {
      category: previous.analysis?.category ?? previous.category,
      severityScore: previous.analysis?.severityScore ?? previous.severityScore ?? null,
    };
    previous.analysis = analysis;
    previous.triageOverride = {
      category: fields.some(([field]) => field === "category"),
      severity: fields.some(([field]) => field === "severityScore"),
      updatedAt: new Date().toISOString(),
    };
    const columns = reportColumns(previous);
    persistReportColumns(columns);
    const insertAudit = database.prepare(`
      INSERT INTO report_field_audits (
        id, report_id, field, actor_id, actor_email, old_value, new_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [field, oldValue, newValue] of fields) {
      insertAudit.run(
        randomUUID(),
        id,
        field,
        actor.id,
        actor.email,
        String(oldValue ?? ""),
        String(newValue),
        now,
      );
    }
    return previous;
  });
  return update();
}

export async function splitDuplicateReport(id) {
  const split = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    if (!row) return { error: "not_found" };
    const report = mapReportRow(row);
    if (!report.duplicateOf) return { error: "not_duplicate" };
    const parentRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(report.duplicateOf);
    if (!parentRow) return { error: "parent_not_found" };
    const parent = mapReportRow(parentRow);
    report.duplicateOf = null;
    report.reportCount = 1;
    persistReportColumns(reportColumns(report));
    parent.reportCount = Math.max(1, (Number(parent.reportCount) || 1) - 1);
    persistReportColumns(reportColumns(parent));
    return { report, parent };
  });
  return split();
}

export async function mergeReports(targetId, sourceId) {
  const merge = database.transaction(() => {
    if (targetId === sourceId) return { error: "same_report" };
    const targetRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(targetId);
    const sourceRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(sourceId);
    if (!targetRow || !sourceRow) return { error: "not_found" };
    const target = mapReportRow(targetRow);
    const source = mapReportRow(sourceRow);
    if (target.duplicateOf) return { error: "target_is_duplicate" };
    if (source.duplicateOf) return { error: "source_is_duplicate" };
    if (target.category.toLowerCase() !== source.category.toLowerCase()) {
      return { error: "category_mismatch" };
    }

    const canonicalSourceId = source.id;
    const canonicalSourceRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(canonicalSourceId);
    const canonicalSource = mapReportRow(canonicalSourceRow);
    if (canonicalSource.status === "Resolved" || target.status === "Resolved") {
      return { error: "resolved_report" };
    }
    const sourceChildren = database.prepare(
      "SELECT * FROM reports WHERE duplicate_of = ?",
    ).all(canonicalSourceId).map(mapReportRow);
    target.reportCount = (Number(target.reportCount) || 1) +
      (Number(canonicalSource.reportCount) || 1);
    persistReportColumns(reportColumns(target));

    const movedChildren = [...sourceChildren, ...(source.id === canonicalSourceId ? [] : [source])];
    for (const child of movedChildren) {
      child.duplicateOf = target.id;
      persistReportColumns(reportColumns(child));
    }
    if (canonicalSource.id !== target.id) {
      canonicalSource.duplicateOf = target.id;
      canonicalSource.reportCount = 1;
      persistReportColumns(reportColumns(canonicalSource));
    }
    return { target, source: canonicalSource };
  });
  return merge();
}

export async function deleteReport(id) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }

  const remove = database.transaction(() => {
    const row = database.prepare("SELECT * FROM reports WHERE id = ?").get(id);
    if (!row) return null;
    const report = mapReportRow(row);
    if (report.duplicateOf) {
      const parentRow = database.prepare("SELECT * FROM reports WHERE id = ?").get(report.duplicateOf);
      if (parentRow) {
        const parent = mapReportRow(parentRow);
        parent.reportCount = Math.max(1, (Number(parent.reportCount) || 1) - 1);
        persistReportColumns(reportColumns(parent));
      }
    } else {
      const children = database.prepare("SELECT * FROM reports WHERE duplicate_of = ?").all(id);
      for (const childRow of children) {
        const child = mapReportRow(childRow);
        child.duplicateOf = null;
        child.reportCount = 1;
        persistReportColumns(reportColumns(child));
      }
    }
    database.prepare("DELETE FROM report_timeline WHERE report_id = ?").run(id);
    database.prepare("DELETE FROM report_field_audits WHERE report_id = ?").run(id);
    database.prepare("DELETE FROM report_audits WHERE report_id = ?").run(id);
    database.prepare("DELETE FROM reports WHERE id = ?").run(id);
    return mapReportRow(row);
  });

  const deletedReport = remove();
  return deletedReport ? clone(deletedReport) : null;
}

export async function getImpactMetrics() {
  const resolved = database.prepare(`
    SELECT COUNT(*) AS count
    FROM reports
    WHERE duplicate_of IS NULL AND json_extract(payload, '$.status') = 'Resolved'
  `).get().count;
  const total = database.prepare(
    "SELECT COUNT(*) AS count FROM reports WHERE duplicate_of IS NULL",
  ).get().count;
  const times = database.prepare(`
    SELECT report_id,
      MIN(CASE WHEN status = 'Received' THEN created_at END) AS received_at,
      MIN(CASE WHEN status = 'Triaged' THEN created_at END) AS triaged_at,
      MAX(CASE WHEN status = 'Resolved' THEN created_at END) AS resolved_at
    FROM report_timeline
    WHERE report_id IN (SELECT id FROM reports WHERE duplicate_of IS NULL)
    GROUP BY report_id
  `).all();
  const averageHours = (values) => {
    const durations = values
      .filter((entry) => entry.started && entry.ended)
      .map((entry) => (Date.parse(entry.ended) - Date.parse(entry.started)) / 3_600_000)
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    return durations.length
      ? Number((durations.reduce((sum, duration) => sum + duration, 0) / durations.length).toFixed(1))
      : null;
  };
  const byCategory = database.prepare(`
    SELECT category, SUM(report_count) AS count
    FROM reports
    WHERE duplicate_of IS NULL
    GROUP BY category
    ORDER BY count DESC, category ASC
  `).all();
  const totalSubmissions = byCategory.reduce((sum, category) => sum + category.count, 0);
  return {
    averageHoursToTriage: averageHours(times.map((entry) => ({
      started: entry.received_at,
      ended: entry.triaged_at,
    }))),
    averageHoursToResolve: averageHours(times.map((entry) => ({
      started: entry.received_at,
      ended: entry.resolved_at,
    }))),
    resolutionRate: total ? Number(((resolved / total) * 100).toFixed(1)) : 0,
    reportsByCategory: byCategory,
    totalSubmissions,
  };
}

export async function getCityHealthMetrics() {
  const totals = database.prepare(`
    SELECT
      COALESCE(SUM(report_count - confirmation_count), 0) AS total_reports,
      COALESCE(SUM(CASE WHEN json_extract(payload, '$.status') = 'Resolved' THEN report_count - confirmation_count ELSE 0 END), 0) AS resolved_reports,
      COALESCE(SUM(CASE WHEN json_extract(payload, '$.status') != 'Resolved' OR json_extract(payload, '$.status') IS NULL THEN report_count - confirmation_count ELSE 0 END), 0) AS open_reports
    FROM reports
    WHERE duplicate_of IS NULL
  `).get();
  const resolutionTimes = database.prepare(`
    SELECT
      MIN(CASE WHEN status = 'Received' THEN created_at END) AS received_at,
      MAX(CASE WHEN status = 'Resolved' THEN created_at END) AS resolved_at
    FROM report_timeline
    WHERE report_id IN (SELECT id FROM reports WHERE duplicate_of IS NULL)
    GROUP BY report_id
  `).all();
  const resolvedDurations = resolutionTimes
    .filter((entry) => entry.received_at && entry.resolved_at)
    .map((entry) => (
      (Date.parse(entry.resolved_at) - Date.parse(entry.received_at)) / 3_600_000
    ))
    .filter((hours) => Number.isFinite(hours) && hours >= 0);
  const averageHoursToResolve = resolvedDurations.length
    ? Number((
        resolvedDurations.reduce((sum, hours) => sum + hours, 0) / resolvedDurations.length
      ).toFixed(1))
    : null;
  const categoryRows = database.prepare(`
    SELECT
      category,
      SUM(report_count - confirmation_count) AS total_reports,
      SUM(CASE WHEN json_extract(payload, '$.status') = 'Resolved' THEN report_count - confirmation_count ELSE 0 END) AS resolved_reports
    FROM reports
    WHERE duplicate_of IS NULL
    GROUP BY category
    ORDER BY total_reports DESC, category ASC
  `).all();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const mapCells = database.prepare(`
    SELECT
      ROUND(latitude, 2) AS lat,
      ROUND(longitude, 2) AS lng,
      COUNT(*) AS count
    FROM reports
    WHERE created_at >= ?
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    GROUP BY ROUND(latitude, 2), ROUND(longitude, 2)
    ORDER BY count DESC
  `).all(cutoff).map((cell) => ({
    lat: cell.lat,
    lng: cell.lng,
    count: cell.count,
  }));
  const totalReports = totals.total_reports;
  return {
    totalReports,
    openReports: totals.open_reports,
    resolvedReports: totals.resolved_reports,
    averageHoursToResolve,
    resolutionRate: totalReports
      ? Number(((totals.resolved_reports / totalReports) * 100).toFixed(1))
      : 0,
    resolutionRateByCategory: categoryRows.map((row) => ({
      category: row.category,
      totalReports: row.total_reports,
      resolvedReports: row.resolved_reports,
      resolutionRate: row.total_reports
        ? Number(((row.resolved_reports / row.total_reports) * 100).toFixed(1))
        : 0,
    })),
    mapCells,
  };
}
