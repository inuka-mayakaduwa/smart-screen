import assert from "node:assert/strict";
import test from "node:test";
import { formatConnectCode, normalizeConnectCode, secretsMatch, hashSecret } from "./tokens.js";

test("connect codes ignore spaces and dashes", () => {
  assert.equal(normalizeConnectCode(" abcd-efgh "), "ABCDEFGH");
  assert.equal(formatConnectCode("ABCDEFGH"), "ABCD-EFGH");
});

test("secret comparison uses the stored hash", () => {
  const hash = hashSecret("device-token");
  assert.equal(secretsMatch("device-token", hash), true);
  assert.equal(secretsMatch("other-token", hash), false);
});
