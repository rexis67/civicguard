import { cityConfig } from "./cityConfig.js";

const DEFAULT_CATEGORY_DEPARTMENTS = {
  ...Object.fromEntries(
    Object.entries(cityConfig.categoryDepartments).map(([category, department]) => [
      category.toLowerCase(),
      department,
    ]),
  ),
};

const DEFAULT_SLA_HOURS = cityConfig.slaHoursBySeverity;

function readJsonEnvironment(name, fallback, validate) {
  const raw = process.env[name];
  if (!raw) return fallback;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must contain valid JSON.`, { cause: error });
  }
  if (!validate(value)) throw new Error(`${name} has an invalid configuration shape.`);
  return value;
}

const configuredDepartments = readJsonEnvironment(
  "CATEGORY_DEPARTMENTS",
  DEFAULT_CATEGORY_DEPARTMENTS,
  (value) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([category, department]) =>
      category.trim().length > 0 && typeof department === "string" && department.trim().length > 0),
);
const categoryDepartments = Object.fromEntries(
  Object.entries(configuredDepartments).map(([category, department]) => [
    category.toLowerCase(),
    department,
  ]),
);

const slaHoursBySeverity = readJsonEnvironment(
  "SLA_HOURS_BY_SEVERITY",
  DEFAULT_SLA_HOURS,
  (value) => value && typeof value === "object" && !Array.isArray(value) &&
    [1, 2, 3, 4, 5].every((severity) =>
      Number.isFinite(value[severity]) && value[severity] > 0),
);

export function getRoutingDetails(category, severityScore, createdAt) {
  const department = categoryDepartments[String(category).toLowerCase()] ?? "Municipal Services";
  const severity = Math.min(5, Math.max(1, Math.round(Number(severityScore) || 3)));
  const slaHours = slaHoursBySeverity[severity];
  const createdTime = Date.parse(createdAt);
  if (!Number.isFinite(createdTime)) throw new TypeError("A valid report creation timestamp is required.");
  return {
    department,
    slaHours,
    slaDueAt: new Date(createdTime + slaHours * 3_600_000).toISOString(),
  };
}

export function withSlaState(report) {
  const dueTime = Date.parse(report.slaDueAt);
  const remainingMs = Number.isFinite(dueTime) ? dueTime - Date.now() : null;
  return {
    ...report,
    remainingMs,
    overdue: report.status !== "Resolved" && remainingMs !== null && remainingMs < 0,
  };
}
