import { Router } from "express";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { authenticate, allowRoles } from "../../middleware/authenticate.js";
import { prescriptionSchema } from "./prescription.schemas.js";

export const prescriptionRouter = Router();

prescriptionRouter.use(authenticate);

// Start a scheduled consultation. Only its assigned doctor may start it.
prescriptionRouter.post(
  "/:id/start",
  allowRoles("DOCTOR"),
  async (req, res) => {
    const id = req.params.id;

    if (typeof id !== "string") {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid consultation ID" } });
      return;
    }

    try {
      const consultation = await prisma.consultation.findUnique({
        where: { id },
        select: { id: true, status: true, doctor: { select: { userId: true } } },
      });

      if (!consultation) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Consultation not found" } });
        return;
      }

      if (consultation.doctor.userId !== req.auth!.userId) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your consultation" } });
        return;
      }

      const updated = await prisma.consultation.updateMany({
        where: { id, status: "SCHEDULED" },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });

      if (updated.count !== 1) {
        res.status(409).json({
          error: { code: "INVALID_STATE", message: "Only scheduled consultations can be started" },
        });
        return;
      }

      await prisma.auditLog.create({
        data: {
          actorUserId: req.auth!.userId,
          action: "CONSULTATION_STARTED",
          resourceType: "CONSULTATION",
          resourceId: id,
        },
      });

      res.status(200).json({ id, status: "IN_PROGRESS" });
    } catch {
      res.status(500).json({
        error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to start consultation" },
      });
    }
  },
);

// Complete an in-progress consultation.
prescriptionRouter.post(
  "/:id/complete",
  allowRoles("DOCTOR"),
  async (req, res) => {
    const id = req.params.id;

    if (typeof id !== "string") {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid consultation ID" } });
      return;
    }

    try {
      const consultation = await prisma.consultation.findUnique({
        where: { id },
        select: { id: true, status: true, doctor: { select: { userId: true } } },
      });

      if (!consultation) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Consultation not found" } });
        return;
      }

      if (consultation.doctor.userId !== req.auth!.userId) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your consultation" } });
        return;
      }

      const updated = await prisma.consultation.updateMany({
        where: { id, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      if (updated.count !== 1) {
        res.status(409).json({
          error: { code: "INVALID_STATE", message: "Only in-progress consultations can be completed" },
        });
        return;
      }

      await prisma.auditLog.create({
        data: {
          actorUserId: req.auth!.userId,
          action: "CONSULTATION_COMPLETED",
          resourceType: "CONSULTATION",
          resourceId: id,
        },
      });

      res.status(200).json({ id, status: "COMPLETED" });
    } catch {
      res.status(500).json({
        error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to complete consultation" },
      });
    }
  },
);

// Only the assigned doctor may issue a prescription for a completed consultation.
prescriptionRouter.post(
  "/:id/prescription",
  allowRoles("DOCTOR"),
  async (req, res) => {
    const id = req.params.id;
    const parsed = prescriptionSchema.safeParse(req.body);

    if (typeof id !== "string") {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid consultation ID" } });
      return;
    }

    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid prescription",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const consultation = await tx.consultation.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            doctor: { select: { userId: true } },
            prescription: { select: { id: true } },
          },
        });

        if (!consultation) return { kind: "not_found" as const };
        if (consultation.doctor.userId !== req.auth!.userId) {
          return { kind: "forbidden" as const };
        }
        if (consultation.status !== "COMPLETED") {
          return { kind: "not_completed" as const };
        }
        if (consultation.prescription) {
          return { kind: "exists" as const };
        }

        const prescription = await tx.prescription.create({
          data: {
            consultationId: id,
            doctorNotes: parsed.data.doctorNotes,
            medicationItems: parsed.data.medicationItems as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            consultationId: true,
            doctorNotes: true,
            medicationItems: true,
            issuedAt: true,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: req.auth!.userId,
            action: "PRESCRIPTION_ISSUED",
            resourceType: "PRESCRIPTION",
            resourceId: prescription.id,
          },
        });

        return { kind: "created" as const, prescription };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Consultation not found" } });
        return;
      }
      if (result.kind === "forbidden") {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your consultation" } });
        return;
      }
      if (result.kind === "not_completed") {
        res.status(409).json({
          error: { code: "CONSULTATION_NOT_COMPLETED", message: "Complete the consultation first" },
        });
        return;
      }
      if (result.kind === "exists") {
        res.status(409).json({
          error: { code: "PRESCRIPTION_EXISTS", message: "A prescription already exists" },
        });
        return;
      }

      res.status(201).json({ data: result.prescription });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.status(409).json({
          error: { code: "PRESCRIPTION_EXISTS", message: "A prescription already exists" },
        });
        return;
      }

      res.status(500).json({
        error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to issue prescription" },
      });
    }
  },
);

// The patient, assigned doctor, or admin may view the prescription.
prescriptionRouter.get("/:id/prescription", async (req, res) => {
  const id = req.params.id;

  if (typeof id !== "string") {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid consultation ID" } });
    return;
  }

  try {
    const consultation = await prisma.consultation.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        doctor: { select: { userId: true } },
        prescription: {
          select: {
            id: true,
            consultationId: true,
            doctorNotes: true,
            medicationItems: true,
            issuedAt: true,
          },
        },
      },
    });

    if (!consultation) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Consultation not found" } });
      return;
    }

    const user = req.auth!;
    const authorized =
      user.role === "ADMIN" ||
      (user.role === "PATIENT" && consultation.patientId === user.userId) ||
      (user.role === "DOCTOR" && consultation.doctor.userId === user.userId);

    if (!authorized) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied" } });
      return;
    }

    if (!consultation.prescription) {
      res.status(404).json({ error: { code: "PRESCRIPTION_NOT_FOUND", message: "No prescription issued" } });
      return;
    }

    res.status(200).json({ data: consultation.prescription });
  } catch {
    res.status(500).json({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to retrieve prescription" },
    });
  }
});