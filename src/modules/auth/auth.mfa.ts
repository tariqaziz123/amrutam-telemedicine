import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import "dotenv/config";

function encryptionKey(): Buffer {
  const value = process.env.MFA_ENCRYPTION_KEY;

  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("MFA_ENCRYPTION_KEY must be a 64-character hexadecimal key");
  }

  return Buffer.from(value, "hex");
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptMfaSecret(value: string): string {
  const [version, ivHex, tagHex, encryptedHex] = value.split(":");

  if (
    version !== "v1" ||
    !ivHex ||
    !tagHex ||
    !encryptedHex ||
    !/^[a-fA-F0-9]{24}$/.test(ivHex) ||
    !/^[a-fA-F0-9]{32}$/.test(tagHex) ||
    !/^[a-fA-F0-9]+$/.test(encryptedHex)
  ) {
    throw new Error("Invalid encrypted MFA secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex"),
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function createTotpSetup(email: string): {
  secret: string;
  otpauthUrl: string;
} {
  const secret = new OTPAuth.Secret({ size: 20 });

  const totp = new OTPAuth.TOTP({
    issuer: "Amrutam",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  return {
    secret: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;

  const totp = new OTPAuth.TOTP({
    issuer: "Amrutam",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

  return totp.validate({ token, window: 1 }) !== null;
}
