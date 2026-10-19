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

test("share codes are five digits without dashes", () => {
  const code = createShareCode();
  assert.match(code, /^\d{5}$/);
  assert.equal(formatShareCode(code), code);
  assert.equal(formatShareCode("12-345"), "12345");
  assert.equal(normalizeShareCode("12-345"), "12345");
});

test("secret comparison uses the stored hash", () => {
  const hash = hashSecret("device-token");
  assert.equal(secretsMatch("device-token", hash), true);
  assert.equal(secretsMatch("other-token", hash), false);
});
