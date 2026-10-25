import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const reportsFile = resolve(
  process.env.CIVICGUARD_REPORTS_PATH ?? fileURLToPath(new URL("../reports.json", import.meta.url)),
);
const temporaryFile = `${reportsFile}.tmp`;
const usersFile = resolve(
  process.env.CIVICGUARD_LEGACY_USERS_PATH ?? fileURLToPath(new URL("../users.json", import.meta.url)),
);
const migratedUsersFile = `${usersFile}.migrated`;
const databaseFile = resolve(
  process.env.CIVICGUARD_DB_PATH ?? fileURLToPath(new URL("../civicguard.sqlite", import.meta.url)),
);

let reports = [];
let writeQueue = Promise.resolve();
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
`);

async function writeReportsAtomically(nextReports) {
  const serializedReports = `${JSON.stringify(nextReports, null, 2)}\n`;

  try {
    await writeFile(temporaryFile, serializedReports, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, reportsFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

async function initializeReportsFile() {
  let fileContents;

  try {
    fileContents = await readFile(reportsFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    reports = [];
    await writeReportsAtomically(reports);
    return;
  }

  const savedReports = JSON.parse(fileContents);
  if (!Array.isArray(savedReports)) {
    throw new TypeError("backend/reports.json must contain a JSON array.");
  }

  reports = savedReports;
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

await Promise.all([initializeReportsFile(), migrateLegacyUsers()]);

function clone(value) {
  return structuredClone(value);
}

function enqueueWrite(transform) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    const nextReports = transform(reports);
    if (nextReports === null) return null;

    await writeReportsAtomically(nextReports);
    reports = nextReports;
    return nextReports;
  });

  writeQueue = operation;
  return operation;
}

export async function getReports() {
  await writeQueue.catch(() => {});
  return clone(reports);
}

export async function getUserByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const row = database.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  return row ? mapUser(row) : null;
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

  await writeQueue.catch(() => {});
  const report = reports.find((item) => item.id === id);
  return report ? clone(report) : null;
}

export async function saveReport(newReportData) {
  if (!newReportData || typeof newReportData !== "object" || Array.isArray(newReportData)) {
    throw new TypeError("A report object is required.");
  }

  const reportToSave = clone(newReportData);
  await enqueueWrite((currentReports) => [...currentReports, reportToSave]);
  return clone(reportToSave);
}

export async function updateReport(id, patch) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("A patch object is required.");
  }

  const patched = await enqueueWrite((currentReports) => {
    const index = currentReports.findIndex((report) => report.id === id);
    if (index === -1) return null;

    const nextReports = [...currentReports];
    nextReports[index] = { ...nextReports[index], ...patch };
    return nextReports;
  });

  if (patched === null) return null;
  return clone(patched.find((report) => report.id === id));
}

export async function updateReportStatus(id, status) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }
  if (typeof status !== "string" || !status.trim()) {
    throw new TypeError("A non-empty report status is required.");
  }

  const updatedReports = await enqueueWrite((currentReports) => {
    const reportIndex = currentReports.findIndex((report) => report.id === id);
    if (reportIndex === -1) return null;

    return currentReports.map((report, index) =>
      index === reportIndex ? { ...report, status: status.trim() } : report,
    );
  });

  if (updatedReports === null) return null;
  return clone(updatedReports.find((report) => report.id === id));
}

export async function deleteReport(id) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("A report ID is required.");
  }

  let deletedReport = null;
  const updatedReports = await enqueueWrite((currentReports) => {
    deletedReport = currentReports.find((report) => report.id === id) ?? null;
    if (!deletedReport) return null;
    return currentReports.filter((report) => report.id !== id);
  });

  return updatedReports === null ? null : clone(deletedReport);
}
