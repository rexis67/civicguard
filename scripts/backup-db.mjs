import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(path.resolve(scriptsDir, "..", "backend", "package.json"));
const Database = require("better-sqlite3");
dotenv.config({ path: path.resolve(scriptsDir, "..", "backend", ".env") });

const databaseFile = path.resolve(
  process.env.DB_PATH ??
    process.env.CIVICGUARD_DB_PATH ??
    path.resolve(scriptsDir, "..", "backend", "civicguard.sqlite"),
);

const backupDir = path.resolve(path.dirname(databaseFile), "backups");
const RETENTION_DAYS = 14;

async function runBackup() {
  console.info(`[backup] Starting database backup for: ${databaseFile}`);

  if (!existsSync(databaseFile)) {
    console.warn(`[backup] Database file does not exist at ${databaseFile}. Skipping.`);
    return;
  }

  await mkdir(backupDir, { recursive: true });

  // 1. Flush WAL logs to the main database file safely
  const db = new Database(databaseFile);
  try {
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)");
    console.info(`[backup] WAL checkpoint result:`, checkpoint);

    // Clean up expired password reset tokens and old unverified tokens for data hygiene
    const now = Date.now();
    const tokenPrune = db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ?").run(now);
    console.info(`[backup] Pruned ${tokenPrune.changes} expired password reset tokens.`);
  } finally {
    db.close();
  }

  // 2. Create timestamped snapshot
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `civicguard-snapshot-${timestamp}.sqlite`;
  const backupFilePath = path.join(backupDir, backupFileName);

  await copyFile(databaseFile, backupFilePath);
  const { size } = await stat(backupFilePath);
  console.info(`[backup] Snapshot created: ${backupFilePath} (${(size / 1024).toFixed(1)} KB)`);

  // 3. Prune snapshots older than RETENTION_DAYS
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = await readdir(backupDir);
  let prunedCount = 0;

  for (const file of files) {
    if (!file.startsWith("civicguard-snapshot-")) continue;
    const fullPath = path.join(backupDir, file);
    const fileStat = await stat(fullPath);
    if (fileStat.mtimeMs < cutoffMs) {
      await unlink(fullPath);
      prunedCount += 1;
    }
  }

  if (prunedCount > 0) {
    console.info(`[backup] Pruned ${prunedCount} snapshot(s) older than ${RETENTION_DAYS} days.`);
  }
  console.info(`[backup] Backup completed successfully.`);
}

runBackup().catch((error) => {
  console.error(`[backup] Backup failed:`, error);
  process.exit(1);
});
