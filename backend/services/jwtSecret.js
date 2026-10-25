import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const localSecretFile = fileURLToPath(new URL("../.jwt-secret", import.meta.url));
let localSecretPromise;

async function readLocalSecret() {
  const secret = (await readFile(localSecretFile, "utf8")).trim();
  if (secret.length < 32) {
    throw new Error("The local JWT secret is invalid. Remove backend/.jwt-secret to regenerate it.");
  }
  return secret;
}

async function loadOrCreateLocalSecret() {
  try {
    return await readLocalSecret();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const secret = randomBytes(64).toString("base64url");
  try {
    await writeFile(localSecretFile, `${secret}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return secret;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readLocalSecret();
  }
}

export async function getJwtSecret() {
  const configuredSecret = process.env.JWT_SECRET;
  if (configuredSecret) {
    if (configuredSecret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long.");
    }
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }

  localSecretPromise ??= loadOrCreateLocalSecret();
  return localSecretPromise;
}
