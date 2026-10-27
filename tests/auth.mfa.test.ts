import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  verifyTotp,
} from "../src/modules/auth/auth.mfa.js";
import * as OTPAuth from "otpauth";

describe("MFA security helpers", () => {
  it("encrypts secrets and decrypts them correctly", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptMfaSecret(secret);

    assert.notEqual(encrypted, secret);
    assert.equal(decryptMfaSecret(encrypted), secret);
  });

  it("rejects a tampered encrypted secret", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    const parts = encrypted.split(":");
    parts[3] = "00" + parts[3];

    assert.throws(() => decryptMfaSecret(parts.join(":")));
  });

  it("accepts a valid TOTP and rejects an invalid code", () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "Amrutam",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });

    assert.equal(verifyTotp(secret.base32, totp.generate()), true);
    assert.equal(verifyTotp(secret.base32, "000000"), false);
    assert.equal(verifyTotp(secret.base32, "invalid"), false);
  });
});
