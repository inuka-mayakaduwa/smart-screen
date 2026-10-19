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

/** Five-digit room share code (100k space), shown as digits only: 12345. */
export function createShareCode(): string {
  const value = randomBytes(3).readUIntBE(0, 3) % 100_000;
  return String(value).padStart(5, "0");
}

export function formatShareCode(code: string): string {
  return normalizeShareCode(code);
}

export function normalizeShareCode(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : digits;
}

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function adminToken(password: string): string {
  return hashSecret(`admin:${password}`);
}
