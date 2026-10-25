import assert from "node:assert/strict";
import test from "node:test";
import {
  createShareCode,
  formatConnectCode,
  formatShareCode,
  normalizeConnectCode,
  normalizeShareCode,
  secretsMatch,
  hashSecret,
} from "./tokens.js";

test("connect codes ignore spaces and dashes", () => {
  assert.equal(normalizeConnectCode(" abcd-efgh "), "ABCDEFGH");
  assert.equal(formatConnectCode("ABCDEFGH"), "ABCD-EFGH");
});

test("share codes are six characters from the connect alphabet", () => {
  const code = createShareCode();
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(formatShareCode(code), code);
  assert.equal(formatShareCode("4nq wrv"), "4NQWRV");
  assert.equal(normalizeShareCode("4NQ-WRV"), "4NQWRV");
  assert.equal(normalizeShareCode("4NQWRVXYZ"), "4NQWRV");
});

test("secret comparison uses the stored hash", () => {
  const hash = hashSecret("device-token");
  assert.equal(secretsMatch("device-token", hash), true);
  assert.equal(secretsMatch("other-token", hash), false);
});
