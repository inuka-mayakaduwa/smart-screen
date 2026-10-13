import { HttpError } from "./http.js";
import type { AppRelease } from "./types.js";

const APK_BYTES = 180 * 1024 * 1024;

export const APK_LIMIT_BYTES = APK_BYTES;
export const APK_FILENAME = "room.apk";

export function presentRelease(release: AppRelease | null) {
  if (!release) return null;
  return {
    versionCode: release.versionCode,
    versionName: release.versionName,
    bytes: release.bytes,
    uploadedAt: release.uploadedAt,
    notes: release.notes,
  };
}

export function readReleaseFields(
  body: { versionCode?: unknown; versionName?: unknown; notes?: unknown },
  current: number | null,
): { versionCode: number; versionName: string; notes: string } {
  const versionCode = Number(body.versionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new HttpError(400, "Enter a version code of 1 or more");
  if (current !== null && versionCode <= current) {
    throw new HttpError(400, `Version code must be higher than the published ${current}`);
  }
  const versionName = typeof body.versionName === "string" ? body.versionName.trim() : "";
  if (!versionName || versionName.length > 40) throw new HttpError(400, "Enter a version name");
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 280) : "";
  return { versionCode, versionName, notes };
}

export function assertApkFile(file: { originalname?: string; mimetype?: string } | undefined): void {
  if (!file) throw new HttpError(400, "Choose an APK");
  const name = (file.originalname ?? "").toLowerCase();
  const type = (file.mimetype ?? "").toLowerCase();
  const apkType = type === "application/vnd.android.package-archive" || type === "application/octet-stream" || type === "";
  if (!name.endsWith(".apk") || !apkType) throw new HttpError(400, "Choose an APK file");
}
