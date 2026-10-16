import type { AppRelease } from "./types.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function allowDownloadAttempt(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

export function resetDownloadAttempts() {
  attempts.clear();
}

export function downloadPage(release: AppRelease | null, options: { open: boolean; error?: string }): string {
  const body = !release
    ? `<p class="muted">No panel app is published yet.</p>`
    : !options.open
      ? `<p class="muted">Downloads are turned off. Ask an administrator for access.</p>`
      : `<p class="muted">${escapeHtml(release.versionName)} · ${(release.bytes / (1024 * 1024)).toFixed(1)} MB</p>
      ${release.notes ? `<p class="muted">${escapeHtml(release.notes)}</p>` : ""}
      ${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ""}
      <form method="post" action="/api/download/apk">
        <label>Download code
          <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" required autofocus>
        </label>
        <button type="submit">Download APK</button>
      </form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Panel app</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #efeae2; color: #1c1915; font-family: system-ui, sans-serif; padding: 24px; box-sizing: border-box; }
  main { width: min(420px, 100%); background: #fffdf9; border: 1px solid #e3dbd0; border-radius: 18px; padding: 24px; }
  h1 { margin: 0 0 6px; font-size: 28px; }
  .muted { color: #6d655c; margin: 0 0 12px; }
  .error { color: #8d2f2f; margin: 0 0 12px; }
  form { display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #5e574e; }
  input { font: inherit; font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; padding: 12px 14px; border: 1px solid #d9d0c4; border-radius: 12px; }
  button { font: inherit; padding: 12px 16px; border: 0; border-radius: 999px; background: #0c6b52; color: white; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Panel app</h1>
  ${body}
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
