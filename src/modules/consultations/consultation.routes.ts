import { createHash } from "node:crypto";
import { Router } from "express";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { authenticate, allowRoles } from "../../middleware/authenticate.js";
import { bookConsultationSchema, consultationListSchema } from "./consultation.schemas.js";

export const consultationRouter = Router();

function requestHash(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

consultationRouter.post("/", authenticate, allowRoles("PATIENT"), async (req, res) => {
    const parsed = bookConsultationSchema.safeParse(req.body);
    const key = req.get("Idempotency-Key");

    if (!parsed.success) {
        res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: "Invalid booking request" },
        });
        return;
    }

    if (!key || key.length < 8 || key.length > 255) {
        res.status(400).json({
            error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key of 8–255 characters" },
        });
        return;
    }

    const bodyHash = requestHash(parsed.data);

    try {
        const outcome = await prisma.$transaction(async (tx) => {
            const previous = await tx.idempotencyKey.findUnique({
                where: { userId_key: { userId: req.auth!.userId, key } },
            });

            if (previous) {
                if (previous.requestHash !== bodyHash) {
                    return { kind: "conflict" as const };
                }
                if (previous.responseCode !== null && previous.responseBody !== null) {
                    return {
                        kind: "replay" as const,
                        code: previous.responseCode,
                        body: previous.responseBody,
                    };
                }
                return { kind: "in_progress" as const };
            }

            const slot = await tx.availabilitySlot.findUnique({
                where: { id: parsed.data.slotId },
                include: { doctor: { select: { active: true, user: { select: { status: true } } } } },
            });

            if (
                !slot ||
                slot.status !== "AVAILABLE" ||
                slot.startAt <= new Date() ||
                !slot.doctor.active ||
                slot.doctor.user.status !== "ACTIVE"
            ) {
                return { kind: "unavailable" as const };
            }

            // Compare-and-set prevents two patients booking the same slot concurrently.
            const claim = await tx.availabilitySlot.updateMany({
                where: { id: slot.id, status: "AVAILABLE", startAt: { gt: new Date() } },
                data: { status: "BOOKED" },
            });

            if (claim.count !== 1) return { kind: "unavailable" as const };

            const consultation = await tx.consultation.create({
                data: {
                    patientId: req.auth!.userId,
                    doctorId: slot.doctorId,
                    slotId: slot.id,
                    reason: parsed.data.reason,
                },
                select: {
                    id: true,
                    patientId: true,
                    doctorId: true,
                    slotId: true,
                    status: true,
                    createdAt: true,
                },
            });

            const responseBody = { data: consultation };

            await tx.idempotencyKey.create({
                data: {
                    userId: req.auth!.userId,
                    key,
                    requestHash: bodyHash,
                    responseCode: 201,
                    responseBody,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: req.auth!.userId,
                    action: "CONSULTATION_BOOKED",
                    resourceType: "CONSULTATION",
                    resourceId: consultation.id,
                    requestId: typeof req.id === "string" ? req.id : undefined,
                },
            });

            await tx.outboxEvent.create({
                data: {
                    eventType: "consultation.booked",
                    aggregateId: consultation.id,
                    payload: { consultationId: consultation.id, patientId: req.auth!.userId },
                },
            });

            return { kind: "created" as const, body: responseBody };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (outcome.kind === "conflict") {
            res.status(409).json({
                error: { code: "IDEMPOTENCY_KEY_REUSED", message: "This key was already used for a different request" },
            });
            return;
        }

        if (outcome.kind === "in_progress") {
            res.status(409).json({
                error: { code: "REQUEST_IN_PROGRESS", message: "Retry with the same idempotency key" },
            });
            return;
        }

        if (outcome.kind === "unavailable") {
            res.status(409).json({
                error: { code: "SLOT_UNAVAILABLE", message: "This slot is no longer available" },
            });
            return;
        }

        if (outcome.kind === "replay") {
            res.status(outcome.code).json(outcome.body);
            return;
        }

        res.status(201).json(outcome.body);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
            res.status(409).json({
                error: { code: "BOOKING_CONFLICT", message: "Booking conflicted with another request; retry with the same idempotency key" },
            });
            return;
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            res.status(409).json({
                error: { code: "BOOKING_CONFLICT", message: "This slot or idempotency key was concurrently claimed; retry with the same key" },
            });
            return;
        }

        res.status(500).json({
            error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to book consultation" },
        });
    }
});

consultationRouter.get("/", authenticate, async (req, res) => {
    const parsed = consultationListSchema.safeParse(req.query);

    if (!parsed.success) {
        res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: "Invalid pagination" },
        });
        return;
    }

    const { page, limit } = parsed.data;
    const user = req.auth!;

    const where = user.role === "ADMIN"
        ? {}
        : user.role === "DOCTOR"
            ? { doctor: { userId: user.userId } }
            : { patientId: user.userId };

    const [data, total] = await Promise.all([
        prisma.consultation.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                status: true,
                reason: true,
                createdAt: true,
                slot: { select: { startAt: true, endAt: true } },
                doctor: {
                    select: {
                        specialty: true,
                        user: { select: { profile: { select: { firstName: true, lastName: true } } } },
                    },
                },
                patient: {
                    select: { profile: { select: { firstName: true, lastName: true } } },
                },
            },
        }),
        prisma.consultation.count({ where }),
    ]);

    res.status(200).json({
        data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
});

consultationRouter.post("/:id/cancel", authenticate, async (req, res) => {

    const consultationId = req.params.id;
    if (typeof consultationId !== "string") {
        res.status(400).json({
            error: { code: "INVALID_ID", message: "Invalid consultation ID" },
        });
        return;
    }

    const user = req.auth!;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const consultation = await tx.consultation.findUnique({
                where: { id: consultationId },
                include: {
                    doctor: {
                        select: { userId: true },
                    },
                },
            });

            if (!consultation) return { kind: "not_found" as const };

            const authorized = user.role === "ADMIN" ||
                (user.role === "PATIENT" && consultation.patientId === user.userId) ||
                (user.role === "DOCTOR" && consultation.doctor.userId === user.userId);

            if (!authorized) return { kind: "forbidden" as const };
            if (consultation.status !== "SCHEDULED") return { kind: "not_cancellable" as const };

            const updated = await tx.consultation.updateMany({
                where: { id: consultation.id, status: "SCHEDULED" },
                data: { status: "CANCELLED", cancelledAt: new Date() },
            });

            if (updated.count !== 1) return { kind: "not_cancellable" as const };

            await tx.availabilitySlot.updateMany({
                where: { id: consultation.slotId, status: "BOOKED" },
                data: { status: "AVAILABLE" },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: user.userId,
                    action: "CONSULTATION_CANCELLED",
                    resourceType: "CONSULTATION",
                    resourceId: consultation.id,
                },
            });

            return { kind: "cancelled" as const };
        });

        if (result.kind === "not_found") {
            res.status(404).json({ error: { code: "NOT_FOUND", message: "Consultation not found" } });
            return;
        }
        if (result.kind === "forbidden") {
            res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot cancel this consultation" } });
            return;
        }
        if (result.kind === "not_cancellable") {
            res.status(409).json({ error: { code: "NOT_CANCELLABLE", message: "Consultation is no longer cancellable" } });
            return;
        }

        res.status(200).json({ status: "cancelled" });
    } catch {
        res.status(500).json({
            error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to cancel consultation" },
        });
    }
});