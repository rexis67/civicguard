const MAX_DIMENSION = 1600;
const MIN_BYTES_TO_OPTIMIZE = 600 * 1024;
const OUTPUT_QUALITY = 0.82;

/**
 * Downscale large photos in the browser before upload so mobile data and
 * storage stay cheap. Anything we cannot decode (HEIC, SVG, animated GIF)
 * or that would not get smaller is returned untouched.
 */
export async function optimizeImageForUpload(file) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  if (file.size <= MIN_BYTES_TO_OPTIMIZE) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/png") return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) return file;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, file.type, OUTPUT_QUALITY);
    });

    if (!blob || blob.size >= file.size) return file;

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";

    return new File([blob], `${baseName}.${extension}`, {
      type: file.type,
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close?.();
  }
}
