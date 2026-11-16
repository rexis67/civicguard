import { buildSampleReports } from "../backend/data/sampleReports.js";
import { getReportsPage, replaceReports } from "../backend/services/db.js";
const force = process.argv.includes("--force");
const apiBase = (process.env.CIVICGUARD_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5000}`)
  .replace(/\/$/, "");

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

if (await apiIsReachable()) {
  if (!force) {
    console.error(
      [
        `The CivicGuard API is running at ${apiBase}.`,
        "Stop the API, run `npm run seed`, then start it again.",
        "Pass --force to replace reports in the configured SQLite database.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.warn(
    `Warning: an API is running at ${apiBase}; replacing database reports while it runs may interrupt triage.`,
  );
}

const existingCount = (await getReportsPage(1, 0)).total;
if (existingCount > 0 && !force) {
  console.error(
    [
      `${existingCount} report(s) already exist in the configured SQLite database.`,
      "Run `npm run seed -- --force` to replace them with the sample set.",
    ].join("\n"),
  );
  process.exit(1);
}

const seeded = buildSampleReports();
await replaceReports(seeded);

const categoryCounts = seeded.reduce((counts, report) => {
  counts[report.category] = (counts[report.category] ?? 0) + 1;
  return counts;
}, {});
const summary = Object.entries(categoryCounts)
  .map(([category, count]) => `${category} ${count}`)
  .join(" · ");

console.log(`Seeded ${seeded.length} sample reports into the configured SQLite database.`);
console.log(`  ${summary}`);
console.log("Start the API with `npm start` to see them in the live feed.");
