import test from "node:test";
import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";

import {
  hasValidInviteCode,
  isAllowlistedAuthorityEmail,
  isValidEmail,
  normalizeRole,
  parseAuthorityEmailDomains,
} from "../services/authValidation.js";

test("normalizeRole accepts citizen and authority roles", () => {
  assert.equal(normalizeRole("citizen"), "citizen");
  assert.equal(normalizeRole("authority"), "authority");
  assert.equal(normalizeRole("authority member"), "authority");
  assert.equal(normalizeRole("  AUTHORITY  "), "authority");
  assert.equal(normalizeRole("admin"), null);
  assert.equal(normalizeRole(undefined), null);
});

test("hasValidInviteCode only accepts an exact match", () => {
  const secret = "city-ops-secret";
  assert.equal(hasValidInviteCode(secret, secret), true);
  assert.equal(hasValidInviteCode("other-secret", secret), false);
  assert.equal(hasValidInviteCode(undefined, secret), false);
  assert.equal(hasValidInviteCode(secret, ""), false);
  assert.equal(hasValidInviteCode(secret, undefined), false);
});

test("isValidEmail rejects malformed addresses", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("user@localhost"), false);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("two words@example.com"), false);
});

test("isAllowlistedAuthorityEmail matches the domain and its subdomains only", () => {
  const domains = parseAuthorityEmailDomains("example.gov, @city.example");
  assert.deepEqual(domains, ["example.gov", "city.example"]);
  assert.equal(isAllowlistedAuthorityEmail("staff@example.gov", domains), true);
  assert.equal(isAllowlistedAuthorityEmail("staff@permits.example.gov", domains), true);
  assert.equal(isAllowlistedAuthorityEmail("staff@city.example", domains), true);
  assert.equal(isAllowlistedAuthorityEmail("staff@notexample.gov", domains), false);
  assert.equal(isAllowlistedAuthorityEmail("staff@example.gov.evil.test", domains), false);
  assert.equal(isAllowlistedAuthorityEmail("no-domain", domains), false);
  assert.equal(isAllowlistedAuthorityEmail("staff@example.gov", []), false);
});

test("invite checks are deterministic across repeated calls", () => {
  const secret = randomUUID();
  for (let i = 0; i < 20; i += 1) {
    assert.equal(hasValidInviteCode(secret, secret), true);
    assert.equal(hasValidInviteCode("different", secret), false);
  }
});
