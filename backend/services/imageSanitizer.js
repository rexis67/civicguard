import { readFile, writeFile } from "node:fs/promises";

const imageSignatures = {
  "image/jpeg": Buffer.from([0xff, 0xd8]),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

function stripJpegMetadata(buffer) {
  if (!buffer.subarray(0, 2).equals(imageSignatures["image/jpeg"])) {
    throw new TypeError("Image contents do not match the declared JPEG type.");
  }
  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new TypeError("Malformed JPEG image.");
    let markerStart = offset;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xda) {
      if (offset + 2 > buffer.length) throw new TypeError("Malformed JPEG image.");
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new TypeError("Malformed JPEG image.");
      chunks.push(buffer.subarray(markerStart));
      return Buffer.concat(chunks);
    }
    if (marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(buffer.subarray(markerStart, offset));
      if (marker === 0xd9) break;
      continue;
    }
    if (offset + 2 > buffer.length) throw new TypeError("Malformed JPEG image.");
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new TypeError("Malformed JPEG image.");
    const segmentEnd = offset + length;
    // JPEG APP1 can contain Exif GPS or XMP; COM and APP13 can also hold private metadata.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) {
      chunks.push(buffer.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  throw new TypeError("JPEG image has no image data.");
}

function stripPngMetadata(buffer) {
  if (!buffer.subarray(0, 8).equals(imageSignatures["image/png"])) {
    throw new TypeError("Image contents do not match the declared PNG type.");
  }
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  let foundEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new TypeError("Malformed PNG image.");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(type)) {
      chunks.push(buffer.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
  }
  if (!foundEnd) throw new TypeError("PNG image has no end chunk.");
  return Buffer.concat(chunks);
}

function stripWebpMetadata(buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new TypeError("Image contents do not match the declared WebP type.");
  }
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const paddedLength = length + (length % 2);
    const end = offset + 8 + paddedLength;
    if (end > buffer.length) throw new TypeError("Malformed WebP image.");
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = Buffer.from(buffer.subarray(offset, end));
      if (type === "VP8X" && length > 0) chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    offset = end;
  }
  if (offset !== buffer.length || chunks.length === 0) throw new TypeError("Malformed WebP image.");
  const result = Buffer.concat([buffer.subarray(0, 12), ...chunks]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

export async function sanitizeStagedImage(file) {
  if (!file?.path || !file.mimetype) throw new TypeError("An uploaded image is required.");
  const original = await readFile(file.path);
  let sanitized;
  if (file.mimetype === "image/jpeg") sanitized = stripJpegMetadata(original);
  else if (file.mimetype === "image/png") sanitized = stripPngMetadata(original);
  else if (file.mimetype === "image/webp") sanitized = stripWebpMetadata(original);
  else throw new TypeError("Only JPEG, PNG, and WebP images can be safely processed.");

  await writeFile(file.path, sanitized, { mode: 0o600 });
  file.size = sanitized.length;
  return file;
}
