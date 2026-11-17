import { randomUUID } from "node:crypto";
import { test, expect, request } from "@playwright/test";

const authorityEmail = `e2e.${randomUUID()}@example.com`;
const authorityPassword = "E2eAuthorityPassword9!";
const seededReportTitle = `E2E incident ${randomUUID()}`;
const seededLatitude = (Math.random() * 160 - 80).toFixed(6);
const seededLongitude = (Math.random() * 350 - 175).toFixed(6);

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: "http://127.0.0.1:4173" });
  const registration = await api.post("/api/auth/register", {
    data: {
      name: "E2E Authority",
      email: authorityEmail,
      password: authorityPassword,
      role: "authority",
      inviteCode: "civicguard-e2e-invite",
    },
  });
  expect(registration.status()).toBe(201);
  const { verificationUrl } = await registration.json();
  const verificationToken = new URL(verificationUrl).searchParams.get("verifyEmail");
  const verification = await api.post("/api/auth/verify-email", {
    data: { token: verificationToken },
  });
  expect(verification.status()).toBe(200);

  const report = await api.post("/api/reports", {
    multipart: {
      title: seededReportTitle,
      category: "Streetlight",
      description: "Streetlight is not working near the public library.",
      district: "Central",
      latitude: seededLatitude,
      longitude: seededLongitude,
    },
  });
  expect(report.status()).toBe(201);
  await api.dispose();
});

async function signInAsAuthority(page) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email address").fill(authorityEmail);
  await dialog.getByLabel("Password").fill(authorityPassword);
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByText("Authority View")).toBeVisible();
}

async function openOperations(page) {
  await signInAsAuthority(page);
  await page.getByRole("button", { name: "Admin Incident Ops" }).click();
  await expect(page.getByRole("heading", { name: "Municipal Incident Ops" })).toBeVisible();
}

test("loads the public incident feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Live Incident Stream" })).toBeVisible();
  await expect(page.getByText(seededReportTitle)).toBeVisible();
});

test("keeps the report location map contained while scrolling and resizing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Citizen Report Form" }).click();
  const map = page.locator(".civic-map-frame .civic-map");
  await expect(map).toBeVisible();

  const initialY = (await map.boundingBox()).y;
  await page.evaluate(() => window.scrollBy(0, 180));
  const scrolledY = (await map.boundingBox()).y;
  expect(scrolledY).toBeCloseTo(initialY - 180, 0);

  const stacking = await map.evaluate((element) => {
    const style = getComputedStyle(element);
    const frame = element.parentElement.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return {
      isolation: style.isolation,
      zIndex: style.zIndex,
      mapWidth: bounds.width,
      frameWidth: frame.width,
    };
  });
  expect(stacking.isolation).toBe("isolate");
  expect(stacking.zIndex).toBe("0");

  await page.evaluate(() => {
    const mapElement = document.querySelector(".civic-map-frame .civic-map");
    window.scrollBy(0, mapElement.getBoundingClientRect().top - 30);
  });
  const headerCoversMapControls = await map.evaluate((element) => {
    const header = document.querySelector("header");
    const zoom = element.querySelector(".leaflet-control-zoom");
    const bounds = zoom.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 4;
    return header.contains(document.elementFromPoint(x, y));
  });
  expect(headerCoversMapControls).toBe(true);

  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const bounds = await map.evaluate((element) => ({
      mapWidth: element.getBoundingClientRect().width,
      frameWidth: element.parentElement.getBoundingClientRect().width,
    }));
    expect(bounds.mapWidth).toBeLessThanOrEqual(bounds.frameWidth);
  }
});

test("persists the selected theme and exposes a keyboard-focusable map pin", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const themeToggle = page.getByRole("button", { name: /Switch to (light|dark) mode/ });
  await themeToggle.click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await expect(
    page.getByRole("button", { name: `${seededReportTitle}, Streetlight, medium urgency` }),
  ).toBeAttached();
  const mapPin = page.getByRole("button", {
    name: `${seededReportTitle}, Streetlight, medium urgency`,
  });
  await mapPin.focus();
  await expect(mapPin).toBeFocused();
});

test("submits a report and shows it in the feed", async ({ page }) => {
  const title = `E2E submitted ${randomUUID()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Citizen Report Form" }).click();
  await page.getByLabel("Title").fill(title);
  await page.locator("form").getByText("Pothole", { exact: true }).click();
  await page.getByLabel("Description").fill("A pothole is blocking the cycle lane near the park.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("signs in as authority and opens operations", async ({ page }) => {
  await page.goto("/");
  await openOperations(page);
});

test("changes an incident status", async ({ page }) => {
  await page.goto("/");
  await openOperations(page);
  const incidentRow = page.getByRole("row").filter({ hasText: seededReportTitle });
  await incidentRow
    .getByLabel(`Update status for ${seededReportTitle}`)
    .selectOption("Resolved");
  await incidentRow.getByRole("button", { name: "Save status" }).click();
  await expect(incidentRow.locator("td").nth(4)).toHaveText("Resolved");
});

test("exports incidents as CSV", async ({ page }) => {
  await page.goto("/");
  await openOperations(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("civicguard_incidents.csv");
});
