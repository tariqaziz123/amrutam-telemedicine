import { z } from "zod";

export const prescriptionSchema = z.object({
  doctorNotes: z.string().trim().max(5000).optional(),
  medicationItems: z.array(
    z.object({
      name: z.string().trim().min(1).max(200),
      dosage: z.string().trim().min(1).max(100),
      frequency: z.string().trim().min(1).max(100),
      duration: z.string().trim().min(1).max(100),
      instructions: z.string().trim().max(1000).optional(),
    }),
  ).min(1).max(50),
});