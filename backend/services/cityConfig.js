import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_CITY_CONFIG = {
  cityName: "Bengaluru",
  mapCenter: [12.9716, 77.5946],
  departments: [
    "Roads & Infrastructure",
    "Electrical Services",
    "Accessibility Services",
    "Sanitation",
    "Municipal Services",
  ],
  categoryDepartments: {
    Pothole: "Roads & Infrastructure",
    Streetlight: "Electrical Services",
    Accessibility: "Accessibility Services",
    Garbage: "Sanitation",
    "Road Markings": "Roads & Infrastructure",
    "Traffic Signal": "Roads & Infrastructure",
    "Water Leak": "Municipal Services",
  },
  slaHoursBySeverity: { 1: 120, 2: 72, 3: 48, 4: 12, 5: 4 },
  categories: [
    "Pothole",
    "Streetlight",
    "Accessibility",
    "Garbage",
    "Road Markings",
    "Traffic Signal",
    "Water Leak",
  ],
};

function isValidCityConfig(value) {
  return value &&
    typeof value.cityName === "string" &&
    Array.isArray(value.mapCenter) &&
    value.mapCenter.length === 2 &&
    value.mapCenter.every(Number.isFinite) &&
    Array.isArray(value.departments) &&
    value.departments.every((department) => typeof department === "string") &&
    value.categoryDepartments &&
    typeof value.categoryDepartments === "object" &&
    !Array.isArray(value.categoryDepartments) &&
    value.slaHoursBySeverity &&
    typeof value.slaHoursBySeverity === "object" &&
    !Array.isArray(value.slaHoursBySeverity) &&
    [1, 2, 3, 4, 5].every((severity) =>
      Number.isFinite(value.slaHoursBySeverity[severity]) &&
      value.slaHoursBySeverity[severity] > 0) &&
    Array.isArray(value.categories) &&
    value.categories.length > 0 &&
    value.categories.every((category) => typeof category === "string" && category.trim());
}

function loadCityConfig() {
  try {
    const config = JSON.parse(readFileSync(
      fileURLToPath(new URL("../../config/city.json", import.meta.url)),
      "utf8",
    ));
    if (!isValidCityConfig(config)) {
      throw new Error("config/city.json has an invalid configuration shape.");
    }
    return config;
  } catch (error) {
    if (error.code === "ENOENT") return DEFAULT_CITY_CONFIG;
    throw error;
  }
}

export const cityConfig = loadCityConfig();
