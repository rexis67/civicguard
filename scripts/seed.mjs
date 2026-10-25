import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildSampleReports } from "../backend/data/sampleReports.js";

const workspace = path.resolve(import.meta.dirname, "..");
const reportsFile = path.resolve(
  process.env.CIVICGUARD_REPORTS_PATH ?? path.join(workspace, "backend", "reports.json"),
);
const temporaryFile = `${reportsFile}.seed.tmp`;
const force = process.argv.includes("--force");
const apiBase = (process.env.CIVICGUARD_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5000}`).replace(
  /\/$/,
  "",
);

async function apiIsReachable() {
  try {
    const response = await fetch(`${apiBase}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readExistingReports() {
  try {
    const contents = await readFile(reportsFile, "utf8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeReports(reports) {
  const serialized = `${JSON.stringify(reports, null, 2)}\n`;

  try {
    await writeFile(temporaryFile, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, reportsFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

if (await apiIsReachable()) {
  if (!force) {
    console.error(
      [
        `The CivicGuard API is running at ${apiBase}.`,
        "It keeps reports in memory, so a seed written now would be overwritten on the next write.",
        "Stop the API, run `npm run seed`, then start it again.",
        "Pass --force only if you know the API is using a different data store.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.warn(
    `Warning: an API is running at ${apiBase}. Restart it after seeding, or it will overwrite the sample reports.`,
  );
}

const existing = await readExistingReports();
if (existing.length > 0 && !force) {
  console.error(
    [
      `${existing.length} report(s) already exist in ${reportsFile}.`,
      "Run `npm run seed -- --force` to replace them with the sample set.",
    ].join("\n"),
  );
  process.exit(1);
}

const seeded = buildSampleReports();
await writeReports(seeded);

const categoryCounts = seeded.reduce((counts, report) => {
  counts[report.category] = (counts[report.category] ?? 0) + 1;
  return counts;
}, {});
const summary = Object.entries(categoryCounts)
  .map(([category, count]) => `${category} ${count}`)
  .join(" · ");

console.log(`Seeded ${seeded.length} sample reports into ${reportsFile}`);
console.log(`  ${summary}`);
console.log("Start the API with `npm start` to see them in the live feed.");
