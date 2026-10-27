import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";

export type UserRole = "PATIENT" | "DOCTOR" | "ADMIN";

export interface AccessClaims {
  sub: string;
  role: UserRole;
}

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

if (!accessSecret || accessSecret.length < 32) {
  throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
}

if (!refreshSecret || refreshSecret.length < 32 || refreshSecret === accessSecret) {
  throw new Error("JWT_REFRESH_SECRET must be distinct and at least 32 characters");
}

const issuer = "amrutam-api";
const audience = "amrutam-client";

export function createAccessToken(user: AccessClaims): string {
  return jwt.sign(
    { role: user.role },
    accessSecret!,
    {
      subject: user.sub,
      issuer,
      audience,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"],
    },
  );
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, accessSecret!, {
    issuer,
    audience,
  });

  if (
    typeof decoded === "string" ||
    typeof decoded.sub !== "string" ||
    !["PATIENT", "DOCTOR", "ADMIN"].includes(String(decoded.role))
  ) {
    throw new Error("Invalid access token claims");
  }

  return {
    sub: decoded.sub,
    role: decoded.role as UserRole,
  };
}

export function refreshTokenExpiry(): Date {
  const ttl = process.env.JWT_REFRESH_TTL ?? "7d";
  const match = /^(\d+)([smhd])$/.exec(ttl);

  if (!match) {
    throw new Error("JWT_REFRESH_TTL must look like 15m, 12h, or 7d");
  }

  const units: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return new Date(Date.now() + Number(match[1]) * units[match[2]!]);
}