// src/server/domain/logo-file-rules.ts
// Validation of uploaded tournament logos (SRS-TOUR-02: PNG, JPEG or SVG, ≤ 2 MB). The type is decided from the
// file's leading bytes, never from the file name or the browser's Content-Type, so a renamed file cannot slip
// through. Uploaded files are only ever served as images, never executed (NFR-07).

/** SRS-TOUR-02: maximum logo size. */
export const MAXIMUM_LOGO_BYTES = 2 * 1024 * 1024;

/** Accepted logo formats. */
export type LogoFileType = "png" | "jpeg" | "svg";

/** MIME type served for each format. */
export const LOGO_CONTENT_TYPES: Record<LogoFileType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * Detects the logo format from file content.
 *
 * @param fileBytes - The uploaded bytes.
 * @returns "png", "jpeg" or "svg", or null for anything else.
 */
export function detectLogoFileType(fileBytes: Uint8Array): LogoFileType | null {
  const startsWith = (signature: number[]) => signature.every((signatureByte, byteIndex) => fileBytes[byteIndex] === signatureByte);
  if (startsWith(PNG_SIGNATURE)) return "png";
  if (startsWith(JPEG_SIGNATURE)) return "jpeg";
  // SVG is text: allow an optional BOM, XML declaration, comments or doctype before the <svg root element.
  const leadingText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes.slice(0, 1024)).replace(/^﻿/, "").trimStart();
  const withoutProlog = leadingText.replace(/^(<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[\s\S]*?>\s*)*/i, "");
  return /^<svg[\s>]/i.test(withoutProlog) ? "svg" : null;
}
