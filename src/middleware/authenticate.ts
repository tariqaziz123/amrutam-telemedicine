import type { RequestHandler } from "express";
import { verifyAccessToken } from "../modules/auth/auth.tokens.js";

export const authenticate: RequestHandler = (req, res, next) => {
  const authorization = req.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    return;
  }

  try {
    const claims = verifyAccessToken(authorization.slice(7));

    req.auth = {
      userId: claims.sub,
      role: claims.role,
    };

    next();
  } catch {
    res.status(401).json({
      error: { code: "INVALID_TOKEN", message: "Invalid or expired access token" },
    });
  }
};

export function allowRoles(...roles: Array<"PATIENT" | "DOCTOR" | "ADMIN">): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
      return;
    }

    if (!roles.includes(req.auth.role)) {
      res.status(403).json({
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
      return;
    }

    next();
  };
}