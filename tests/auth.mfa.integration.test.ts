import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import request from "supertest";
import * as OTPAuth from "otpauth";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  encryptMfaSecret,
} from "../src/modules/auth/auth.mfa.js";

describe("MFA login enforcement", () => {
  const email = `mfa-test-${Date.now()}@example.com`;
  const password = "Test-Only-Password-2026!";
  let userId: string | undefined;

  after(async () => {
    if (userId) {
      await prisma.$transaction(async (tx) => {
        await tx.refreshToken.deleteMany({ where: { userId: userId! } });
        await tx.auditLog.deleteMany({ where: { actorUserId: userId! } });
        await tx.user.delete({ where: { id: userId! } });
      });
    }
    await prisma.$disconnect();
  });

  it("requires a valid authenticator code before issuing tokens", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const passwordHash = await bcrypt.hash(password, 4);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "PATIENT",
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: encryptMfaSecret(secret.base32),
        profile: {
          create: { firstName: "MFA", lastName: "Test" },
        },
      },
      select: { id: true },
    });
    userId = user.id;

    const missingCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    assert.equal(missingCode.status, 401);
    assert.equal(missingCode.body.error.code, "MFA_REQUIRED");
    assert.equal(missingCode.body.accessToken, undefined);
    assert.equal(missingCode.body.refreshToken, undefined);

    const totp = new OTPAuth.TOTP({
      issuer: "Amrutam",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });

    const validCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password, totpCode: totp.generate() });

    assert.equal(validCode.status, 200);
    assert.equal(typeof validCode.body.accessToken, "string");
    assert.equal(typeof validCode.body.refreshToken, "string");
  });
});
