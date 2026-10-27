import { z } from "zod";

export const createSlotsSchema = z.object({
  slots: z.array(
    z.object({
      startAt: z.string().datetime({ offset: true }),
      endAt: z.string().datetime({ offset: true }),
    }),
  ).min(1).max(50),
});

export const doctorSearchSchema = z.object({
  specialty: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});