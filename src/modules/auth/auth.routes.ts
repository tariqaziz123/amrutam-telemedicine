import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import QRCode from "qrcode";
import {
  createTotpSetup,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyTotp,
} from "./auth.mfa.js";
import { totpCodeSchema, disableMfaSchema } from "./auth.schemas.js";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from "./auth.tokens.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." },
  },
});

authRouter.use(authLimiter);

function requestId(req: Express.Request): string | undefined {
  const id = (req as Express.Request & { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function auditData(
  req: Express.Request,
  actorUserId: string,
  action: string,
  resourceId: string,
) {
  return {
    actorUserId,
    action,
    resourceType: "USER",
    resourceId,
    requestId: requestId(req),
    ipAddress: null,
  };
}

// Public registration can create PATIENT accounts only.
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid registration details",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const { email, password, firstName, lastName, phone } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: "PATIENT",
          // This demo has no email-verification workflow yet.
          status: "ACTIVE",
          profile: {
            create: { firstName, lastName, phone },
          },
        },
        select: { id: true, email: true, role: true, status: true },
      });

      await tx.auditLog.create({
        data: auditData(req, created.id, "AUTH_REGISTER", created.id),
      });

      return created;
    });

    res.status(201).json({ user });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      res.status(409).json({
        error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" },
      });
      return;
    }

    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to register account" },
    });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid login details" },
    });
    return;
  }

  const { email, password, totpCode } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Use a generic response so callers cannot easily enumerate accounts.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });
    return;
  }

  if (user.status !== "ACTIVE") {
    res.status(403).json({
      error: { code: "ACCOUNT_UNAVAILABLE", message: "This account is not active" },
    });
    return;
  }

    if (user.mfaEnabled) {
    if (!user.mfaSecret || !totpCode) {
      res.status(401).json({
        error: {
          code: "MFA_REQUIRED",
          message: "An authenticator code is required to sign in",
        },
      });
      return;
    }

    let validMfaCode = false;

    try {
      validMfaCode = verifyTotp(
        decryptMfaSecret(user.mfaSecret),
        totpCode,
      );
    } catch {
      validMfaCode = false;
    }

    if (!validMfaCode) {
      res.status(401).json({
        error: {
          code: "INVALID_MFA_CODE",
          message: "Authenticator code is invalid",
        },
      });
      return;
    }
  }

  const refreshToken = createRefreshToken();

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiry(),
      },
    });

    await tx.auditLog.create({
      data: auditData(req, user.id, "AUTH_LOGIN", user.id),
    });
  });

  res.status(200).json({
    user: { id: user.id, email: user.email, role: user.role },
    accessToken: createAccessToken({ sub: user.id, role: user.role }),
    refreshToken,
    tokenType: "Bearer",
    expiresIn: process.env.JWT_ACCESS_TTL ?? "15m",
  });
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "A valid refresh token is required" },
    });
    return;
  }

  const oldHash = hashRefreshToken(parsed.data.refreshToken);
  const newToken = createRefreshToken();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash: oldHash },
        include: { user: true },
      });

      if (
        !existing ||
        existing.revokedAt ||
        existing.expiresAt <= new Date() ||
        existing.user.status !== "ACTIVE"
      ) {
        return null;
      }

      // Conditional update prevents two simultaneous refreshes from
      // successfully rotating the same token.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revoked.count !== 1) return null;

      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: hashRefreshToken(newToken),
          expiresAt: refreshTokenExpiry(),
        },
      });

      await tx.auditLog.create({
        data: auditData(req, existing.userId, "AUTH_REFRESH", existing.userId),
      });

      return {
        userId: existing.user.id,
        role: existing.user.role,
      };
    });

    if (!result) {
      res.status(401).json({
        error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired" },
      });
      return;
    }

    res.status(200).json({
      accessToken: createAccessToken({ sub: result.userId, role: result.role }),
      refreshToken: newToken,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_ACCESS_TTL ?? "15m",
    });
  } catch {
    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to refresh session" },
    });
  }
});

authRouter.post("/logout", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "A valid refresh token is required" },
    });
    return;
  }

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);

  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  res.status(204).send();
});

// Start MFA setup. MFA remains disabled until the code is verified.
authRouter.post("/mfa/setup", authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, status: true, mfaEnabled: true },
    });

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({
        error: { code: "ACCOUNT_UNAVAILABLE", message: "Account is unavailable" },
      });
      return;
    }

    if (user.mfaEnabled) {
      res.status(409).json({
        error: { code: "MFA_ALREADY_ENABLED", message: "MFA is already enabled" },
      });
      return;
    }

    const setup = createTotpSetup(user.email);
    const qrCodeDataUrl = await QRCode.toDataURL(setup.otpauthUrl);

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaPendingSecret: encryptMfaSecret(setup.secret) },
    });

    res.status(200).json({
      message: "Scan the QR code with your authenticator app, then verify the code.",
      qrCodeDataUrl,
      secret: setup.secret,
    });
  } catch {
    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to start MFA setup" },
    });
  }
});

// Enable MFA only after verifying the authenticator code.
authRouter.post("/mfa/verify-setup", authenticate, async (req, res) => {
  const parsed = totpCodeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "A valid six-digit code is required" },
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        status: true,
        mfaEnabled: true,
        mfaPendingSecret: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({
        error: { code: "ACCOUNT_UNAVAILABLE", message: "Account is unavailable" },
      });
      return;
    }

    if (user.mfaEnabled) {
      res.status(409).json({
        error: { code: "MFA_ALREADY_ENABLED", message: "MFA is already enabled" },
      });
      return;
    }

    if (!user.mfaPendingSecret) {
      res.status(400).json({
        error: { code: "MFA_SETUP_REQUIRED", message: "Start MFA setup first" },
      });
      return;
    }

    const secret = decryptMfaSecret(user.mfaPendingSecret);

    if (!verifyTotp(secret, parsed.data.code)) {
      res.status(401).json({
        error: { code: "INVALID_MFA_CODE", message: "Authenticator code is invalid" },
      });
      return;
    }


    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaSecret: user.mfaPendingSecret,
          mfaPendingSecret: null,
          mfaEnabled: true,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: auditData(req, user.id, "AUTH_MFA_ENABLED", user.id),
      });
    });


    res.status(200).json({ message: "MFA enabled successfully" });
  } catch {
    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to verify MFA setup" },
    });
  }
});

// Disable MFA only after checking both the password and current TOTP code.
authRouter.post("/mfa/disable", authenticate, async (req, res) => {
  const parsed = disableMfaSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Password and six-digit code are required" },
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        status: true,
        passwordHash: true,
        mfaEnabled: true,
        mfaSecret: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({
        error: { code: "ACCOUNT_UNAVAILABLE", message: "Account is unavailable" },
      });
      return;
    }

    if (
      !user.mfaEnabled ||
      !user.mfaSecret ||
      !(await bcrypt.compare(parsed.data.password, user.passwordHash)) ||
      !verifyTotp(decryptMfaSecret(user.mfaSecret), parsed.data.code)
    ) {
      res.status(401).json({
        error: { code: "MFA_VERIFICATION_FAILED", message: "Password or authenticator code is invalid" },
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaPendingSecret: null,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: auditData(req, user.id, "AUTH_MFA_DISABLED", user.id),
      });
    });

    res.status(200).json({
      message: "MFA disabled. Please sign in again to establish a new session.",
    });
  } catch {
    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to disable MFA" },
    });
  }
});

// Protected endpoint for verifying that authentication middleware works.
authRouter.get("/me", authenticate, async (req, res) => {
  const userId = req.auth!.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      profile: {
        select: { firstName: true, lastName: true, phone: true },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({
      error: { code: "ACCOUNT_UNAVAILABLE", message: "Account is unavailable" },
    });
    return;
  }

  res.status(200).json({ user });
});

// Example role-protected route for testing RBAC.
authRouter.get("/admin-check", authenticate, async (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Admin access required" },
    });
    return;
  }

  res.status(200).json({ status: "ok" });
});