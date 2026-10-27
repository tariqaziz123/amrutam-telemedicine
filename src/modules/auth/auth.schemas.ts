import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(72),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(72),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
});

export const disableMfaSchema = z.object({
  password: z.string().min(1).max(72),
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
});
