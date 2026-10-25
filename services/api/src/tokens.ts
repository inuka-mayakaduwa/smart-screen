import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createId(): string {
  return randomUUID();
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretsMatch(candidate: string, hash: string): boolean {
  const candidateHash = hashSecret(candidate);
  const left = Buffer.from(candidateHash, "hex");
  const right = Buffer.from(hash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createConnectCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return code;
}

export function formatConnectCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeConnectCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export const SHARE_CODE_LENGTH = 6;

/**
 * Six-character room share code shown as two halves on the panel (4NQ WRV).
 * Uses the connect-code alphabet (A to Z and 2 to 9, no I, O, 0 or 1).
 * Must stay shorter than the 8-character whiteboard code: nginx routes by length.
 */
export function createShareCode(): string {
  const bytes = randomBytes(SHARE_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i += 1) {
    code += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return code;
}

export function formatShareCode(code: string): string {
  return normalizeShareCode(code);
}

export function normalizeShareCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, SHARE_CODE_LENGTH);
}

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function adminToken(password: string): string {
  return hashSecret(`admin:${password}`);
}
