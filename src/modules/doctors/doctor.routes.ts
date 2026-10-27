import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authenticate, allowRoles } from "../../middleware/authenticate.js";
import { createSlotsSchema, doctorSearchSchema } from "./doctor.schemas.js";

export const doctorRouter = Router();

doctorRouter.get("/", async (req, res) => {
  const parsed = doctorSearchSchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid search filters" },
    });
    return;
  }

  const { specialty, page, limit } = parsed.data;
  const where = {
    active: true,
    ...(specialty ? { specialty: { contains: specialty, mode: "insensitive" as const } } : {}),
  };

  const [doctors, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { specialty: "asc" },
      select: {
        id: true,
        specialty: true,
        qualifications: true,
        bio: true,
        consultationFee: true,
        user: {
          select: {
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    }),
    prisma.doctor.count({ where }),
  ]);

  res.status(200).json({
    data: doctors,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

doctorRouter.get("/:doctorId/slots", async (req, res) => {
  const slots = await prisma.availabilitySlot.findMany({
    where: {
      doctorId: req.params.doctorId,
      status: "AVAILABLE",
      startAt: { gt: new Date() },
      doctor: { active: true, user: { status: "ACTIVE" } },
    },
    orderBy: { startAt: "asc" },
    take: 100,
    select: { id: true, startAt: true, endAt: true, status: true },
  });

  res.status(200).json({ data: slots });
});

doctorRouter.post(
  "/:doctorId/slots",
  authenticate,
  allowRoles("DOCTOR"),
  async (req, res) => {
    const parsed = createSlotsSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid availability slots" },
      });
      return;
    }

    const doctor = await prisma.doctor.findUnique({
      where: { userId: req.auth!.userId },
      select: { id: true, active: true },
    });

    if (!doctor || !doctor.active || doctor.id !== req.params.doctorId) {
      res.status(403).json({
        error: { code: "FORBIDDEN", message: "You cannot manage this doctor's availability" },
      });
      return;
    }

    const now = Date.now();
    const slots = parsed.data.slots.map((slot) => ({
      doctorId: doctor.id,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
    }));

    if (slots.some((slot) =>
      slot.startAt.getTime() <= now || slot.endAt.getTime() <= slot.startAt.getTime()
    )) {
      res.status(400).json({
        error: { code: "INVALID_SLOT_TIME", message: "Slots must have a future start and end after start" },
      });
      return;
    }

    // Reject overlapping slots within the submitted batch.
    const sorted = [...slots].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startAt < sorted[i - 1]!.endAt) {
        res.status(400).json({
          error: { code: "OVERLAPPING_SLOTS", message: "Submitted slots must not overlap" },
        });
        return;
      }
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Also reject overlap with existing slots, not just the submitted batch.
        for (const slot of sorted) {
          const overlap = await tx.availabilitySlot.findFirst({
            where: {
              doctorId: doctor.id,
              startAt: { lt: slot.endAt },
              endAt: { gt: slot.startAt },
            },
            select: { id: true },
          });
          if (overlap) {
            throw new Error("SLOT_OVERLAP");
          }
        }

        return tx.availabilitySlot.createMany({ data: sorted });
      });

      res.status(201).json({ created: created.count });
    } catch (error) {
      if (error instanceof Error && error.message === "SLOT_OVERLAP") {
        res.status(409).json({
          error: { code: "SLOT_OVERLAP", message: "Availability overlaps an existing slot" },
        });
        return;
      }
      res.status(500).json({
        error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to create availability" },
      });
    }
  },
);