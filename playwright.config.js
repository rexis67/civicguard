import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const tempDirectory = path.join(os.tmpdir(), `civicguard-e2e-${process.pid}`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node backend/server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NODE_ENV: "test",
      PORT: String(port),
      SERVE_STATIC: "true",
      CIVICGUARD_DB_PATH: path.join(tempDirectory, "e2e.sqlite"),
      UPLOAD_DIR: path.join(tempDirectory, "uploads"),
      GEMINI_API_KEY: "",
      AUTHORITY_INVITE_CODE: "civicguard-e2e-invite",
      JWT_SECRET: "civicguard-e2e-secret-with-sufficient-length",
      FRONTEND_URL: baseURL,
      RETURN_VERIFICATION_LINK: "true",
      AUTH_RATE_LIMIT: "1000",
      LOGIN_RATE_LIMIT: "1000",
      REPORT_RATE_LIMIT: "1000",
    },
  },
});
