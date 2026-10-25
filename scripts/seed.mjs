import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

const SAMPLE_REPORTS = [
  {
    title: "Pothole swallowing the bike lane on 5th and Main",
    category: "Pothole",
    district: "North District",
    severity: 4,
    urgency: "high",
    status: "In Progress",
    tags: ["pothole", "bike lane", "5th street"],
    hoursAgo: 5,
    description:
      "A pothole roughly two feet wide has opened in the bike lane at the corner of 5th and Main. Cars are swerving into the traffic lane to avoid it, and it fills with water after rain so it is nearly invisible at night. Two cyclists have already had to stop abruptly.",
  },
  {
    title: "Streetlight out on Cedar Avenue for three nights",
    category: "Streetlight",
    district: "Riverside",
    severity: 3,
    urgency: "medium",
    status: "Pending",
    tags: ["streetlight", "dark", "cedar avenue"],
    hoursAgo: 14,
    description:
      "The streetlight in front of 214 Cedar Avenue has been dark for three nights. The stretch between the bus stop and the pedestrian crossing is now completely unlit after sunset, and residents are avoiding it.",
  },
  {
    title: "Broken tactile paving at the central library crossing",
    category: "Accessibility",
    district: "Old Town",
    severity: 4,
    urgency: "high",
    status: "In Progress",
    tags: ["accessibility", "tactile paving", "crosswalk"],
    hoursAgo: 30,
    description:
      "Several tactile paving tiles at the library crossing have lifted and two are missing entirely. A wheelchair user in front of me had to leave the curb ramp and cross in the middle of the road. The hazard is worse when it rains.",
  },
  {
    title: "Overflowing bins behind the market square",
    category: "Garbage",
    district: "Old Town",
    severity: 2,
    urgency: "low",
    status: "Resolved",
    tags: ["garbage", "bins", "market square"],
    hoursAgo: 52,
    description:
      "The three bins behind the market square have not been emptied in over a week. Bags are stacked beside them and seagulls are pulling waste into the alley. It is starting to smell near the cafe seating.",
  },
  {
    title: "Water main leak flooding the sidewalk on Harbor Road",
    category: "Water Leak",
    district: "Harbor",
    severity: 5,
    urgency: "critical",
    status: "Pending",
    tags: ["water leak", "flooding", "harbor road"],
    hoursAgo: 8,
    description:
      "Water has been running out from under the pavement at Harbor Road for two days. The sidewalk is flooded and the water is now reaching the storm drain. It looks like a burst main and the flow gets stronger in the morning.",
  },
  {
    title: "Faded crosswalk markings outside Roosevelt Elementary",
    category: "Road Markings",
    district: "West Ward",
    severity: 3,
    urgency: "medium",
    status: "Pending",
    tags: ["crosswalk", "school zone", "markings"],
    hoursAgo: 26,
    description:
      "The crosswalk paint outside Roosevelt Elementary has almost completely worn away. Drivers are stopping past the line and parents are worried about the morning drop-off. The school zone signs are fine, only the road markings are gone.",
  },
  {
    title: "Illegal dumping on the Greenway trail",
    category: "Garbage",
    district: "Riverside",
    severity: 3,
    urgency: "medium",
    status: "Pending",
    tags: ["dumping", "greenway", "trail"],
    hoursAgo: 20,
    description:
      "Someone has dumped a mattress, two paint cans and several black bags along the Greenway trail just north of the footbridge. The paint cans are leaking onto the path and the pile is blocking half of the walkway.",
  },
  {
    title: "Traffic signal stuck on red at 12th and Pine",
    category: "Traffic Signal",
    district: "North District",
    severity: 4,
    urgency: "high",
    status: "In Progress",
    tags: ["traffic signal", "intersection", "12th street"],
    hoursAgo: 2,
    description:
      "The signal at 12th and Pine stays red for the side street for several minutes at a time, even with no traffic on Pine. Cars are running the light and there was a near miss this morning. It started after the power flickered yesterday.",
  },
  {
    title: "Deep pothole damaging cars in the West Ward",
    category: "Pothole",
    district: "West Ward",
    severity: 4,
    urgency: "high",
    status: "In Progress",
    tags: ["pothole", "tires", "west ward"],
    hoursAgo: 40,
    description:
      "There is a deep pothole in the eastbound lane just before the West Ward shops. It has a sharp edge and I have seen two cars pull over with damaged tires this week. Filling it temporarily would already help until it can be resurfaced properly.",
  },
  {
    title: "Park path lights out near the playground",
    category: "Streetlight",
    district: "Riverside",
    severity: 3,
    urgency: "medium",
    status: "Resolved",
    tags: ["park", "lighting", "playground"],
    hoursAgo: 70,
    description:
      "Four of the path lights between the playground and the river are not working. The path is busy with families until late and the stretch is completely dark once the sun sets.",
  },
  {
    title: "Missed garbage collection on Elm Street",
    category: "Garbage",
    district: "North District",
    severity: 2,
    urgency: "low",
    status: "Resolved",
    tags: ["collection", "elm street", "bins"],
    hoursAgo: 90,
    description:
      "The whole block on Elm Street was skipped during the Tuesday collection. Bins are still at the curb and some neighbours have started putting bags beside them. The rest of the street one block over was collected normally.",
  },
  {
    title: "Wheelchair ramp blocked by construction debris",
    category: "Accessibility",
    district: "West Ward",
    severity: 3,
    urgency: "medium",
    status: "Pending",
    tags: ["accessibility", "ramp", "construction"],
    hoursAgo: 11,
    description:
      "Renovation debris has been left on the wheelchair ramp at the corner of 8th and Willow for four days. Pedestrians can step around it but wheelchairs and strollers cannot get onto the crossing. No permit sign is visible on the site.",
  },
];

function buildReport(sample, now) {
  const timestamp = new Date(now - sample.hoursAgo * 60 * 60 * 1000).toISOString();
  const summary = `${sample.title.charAt(0).toLowerCase()}${sample.title.slice(1)}`.replace(/\.$/, "");

  return {
    id: randomUUID(),
    timestamp,
    title: sample.title,
    category: sample.category,
    description: sample.description,
    district: sample.district,
    status: sample.status,
    image: null,
    analysisStatus: "complete",
    analysis: {
      category: sample.category,
      severityScore: sample.severity,
      urgencyLevel: sample.urgency,
      summary: `${summary}.`,
      tags: sample.tags,
    },
    triagedAt: new Date(new Date(timestamp).getTime() + 45 * 1000).toISOString(),
  };
}

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

const now = Date.now();
const seeded = SAMPLE_REPORTS.map((sample) => buildReport(sample, now)).sort(
  (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
);

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
