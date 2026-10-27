/** Room share codes are six characters from the connect alphabet (A to Z and 2 to 9).
 *  Keep this in step with normalizeShareCode in services/api/src/tokens.ts. */
export const SHARE_CODE_LENGTH = 6;

export function normalizeShareCode(value?: string | null): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, SHARE_CODE_LENGTH);
}

/** "4NQWRV" → ["4NQ", "WRV"]. A short or missing code pads with middle dots. */
export function splitShareCode(code: string): [string, string] {
  const half = SHARE_CODE_LENGTH / 2;
  const padded = (code || "").padEnd(SHARE_CODE_LENGTH, "·");
  return [padded.slice(0, half), padded.slice(half, SHARE_CODE_LENGTH)];
}

/** Read aloud one character at a time: "Share code 4 N Q W R V". */
export function spokenShareCode(code: string): string {
  return code ? `Share code ${code.split("").join(" ")}` : "Share code not ready";
}

/** Host of the share site, for example meet.govtech.lk. */
export function shareHost(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}

/** "meet.govtech.lk/4NQWRV" from the API share URL, or host only while the code is still minting. */
export function shareHostPath(url?: string | null, code?: string | null, fallbackHost?: string | null): string {
  const normalized = normalizeShareCode(code);
  const host = shareHost(url) || fallbackHost || "";
  if (!host) return normalized;
  return normalized ? `${host}/${normalized}` : host;
}
