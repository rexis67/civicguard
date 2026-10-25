import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "node:fs/promises";
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
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
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

export async function storeReportImage({ reportId, file }) {
  if (!file) return null;

  const extension = extensionByMimeType[file.mimetype];
  if (!extension) throw new TypeError("Unsupported image type for storage.");
  const objectKey = `incidents/${reportId}/${randomUUID()}.${extension}`;

  if (storageMode === "s3") {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: file.buffer,
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
  await writeFile(path.join(uploadsDirectory, fileName), file.buffer, {
    flag: "wx",
    mode: 0o600,
  });
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
