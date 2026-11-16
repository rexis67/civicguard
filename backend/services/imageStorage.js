import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream, constants } from "node:fs";
import { access, chmod, copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const backendDirectory = fileURLToPath(new URL("..", import.meta.url));
const uploadsDirectory = path.resolve(process.env.UPLOAD_DIR ?? path.join(backendDirectory, "uploads"));
const storageMode = process.env.REPORT_IMAGE_STORAGE ?? "local";
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION;
const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
const endpoint = process.env.S3_ENDPOINT || undefined;

if (!["local", "s3"].includes(storageMode)) {
  throw new Error("REPORT_IMAGE_STORAGE must be either 'local' or 's3'.");
}
if (storageMode === "s3" && (!bucket || !region || !publicBaseUrl)) {
  throw new Error("S3 image storage requires S3_BUCKET, S3_REGION, and S3_PUBLIC_BASE_URL.");
}

const s3 = storageMode === "s3"
  ? new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
    })
  : null;

const extensionByMimeType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const SUPPORTED_IMAGE_MIME_TYPES = Object.freeze(Object.keys(extensionByMimeType));

function objectUrl(key) {
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function getImageStorageMode() {
  return storageMode;
}

export function getUploadsDirectory() {
  return uploadsDirectory;
}

export async function ensureImageStorageReady() {
  if (storageMode === "local") await mkdir(uploadsDirectory, { recursive: true });
}

export async function checkImageStorageHealth() {
  if (storageMode === "local") {
    await ensureImageStorageReady();
    await access(uploadsDirectory, constants.R_OK | constants.W_OK);
    const probeFile = path.join(uploadsDirectory, `.health-${randomUUID()}`);
    try {
      await writeFile(probeFile, "", { flag: "wx", mode: 0o600 });
    } finally {
      await unlink(probeFile).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { status: "ok", mode: storageMode };
  }

  if (!s3 || !bucket || !region || !publicBaseUrl) {
    throw new Error("S3 image storage is not configured.");
  }
  await s3.config.credentials();
  return { status: "ok", mode: storageMode };
}

export async function getStoredImageForTriage(image) {
  if (!image?.objectKey || !image.mimeType) return null;

  if (image.storage === "s3") {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: image.objectKey,
    }));
    if (!result.Body) throw new Error("Stored report image has no response body.");
    return {
      buffer: Buffer.from(await result.Body.transformToByteArray()),
      mimetype: image.mimeType,
    };
  }

  return {
    path: path.join(uploadsDirectory, path.basename(image.objectKey)),
    mimetype: image.mimeType,
  };
}

export async function storeReportImage({ reportId, file }) {
  if (!file) return null;

  const extension = extensionByMimeType[file.mimetype];
  if (!extension) throw new TypeError("Unsupported image type for storage.");
  const objectKey = `incidents/${reportId}/${randomUUID()}.${extension}`;

  if (storageMode === "s3") {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: file.path ? createReadStream(file.path) : file.buffer,
      ...(file.size ? { ContentLength: file.size } : {}),
      ContentType: file.mimetype,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return {
      url: objectUrl(objectKey),
      objectKey,
      originalName: path.basename(file.originalname || `evidence.${extension}`),
      mimeType: file.mimetype,
      size: file.size,
      storage: "s3",
    };
  }

  await ensureImageStorageReady();
  const fileName = path.basename(objectKey);
  const destination = path.join(uploadsDirectory, fileName);
  if (file.path) {
    let copied = false;
    try {
      await copyFile(file.path, destination, constants.COPYFILE_EXCL);
      copied = true;
      await chmod(destination, 0o600);
      await unlink(file.path);
      file.path = destination;
    } catch (error) {
      if (copied) {
        await unlink(destination).catch((cleanupError) => {
          if (cleanupError.code !== "ENOENT") {
            console.error("[images] Could not remove incomplete stored upload:", cleanupError);
          }
        });
      }
      throw error;
    }
  } else {
    await writeFile(destination, file.buffer, { flag: "wx", mode: 0o600 });
  }
  // Relative URLs keep working behind a proxy and on any hostname. Set
  // API_PUBLIC_BASE_URL only when images are served from a different origin.
  const apiBaseUrl = (process.env.API_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

  return {
    url: `${apiBaseUrl}/uploads/${encodeURIComponent(fileName)}`,
    objectKey: fileName,
    originalName: path.basename(file.originalname || `evidence.${extension}`),
    mimeType: file.mimetype,
    size: file.size,
    storage: "local",
  };
}

export async function deleteStoredImage(image) {
  if (!image?.objectKey) return;

  if (image.storage === "s3") {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: image.objectKey }));
    return;
  }

  await unlink(path.join(uploadsDirectory, path.basename(image.objectKey))).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
