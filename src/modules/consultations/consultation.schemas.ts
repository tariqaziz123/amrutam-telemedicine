import { z } from "zod";

export const bookConsultationSchema = z.object({
  slotId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
});

export const consultationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});