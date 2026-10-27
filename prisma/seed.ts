import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/config/prisma.js";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seed is disabled in production.");
  }

  const password = process.env.SEED_DOCTOR_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "Set SEED_DOCTOR_PASSWORD to a password of at least 12 characters."
    );
  }

  const email =
    process.env.SEED_DOCTOR_EMAIL ?? "doctor.demo@amrutam.local";
  const passwordHash = await bcrypt.hash(password, 12);

  const doctorUser = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: "DOCTOR",
      status: "ACTIVE",
    },
    create: {
      email,
      passwordHash,
      role: "DOCTOR",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: "Demo",
          lastName: "Doctor",
        },
      },
    },
  });

  // Ensure a profile exists if the user was already present.
  await prisma.profile.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      firstName: "Demo",
      lastName: "Doctor",
    },
  });

  const doctor = await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: { active: true },
    create: {
      userId: doctorUser.id,
      licenseNumber: "DEMO-LICENSE-001",
      specialty: "General Medicine",
      qualifications: "MBBS",
      bio: "Demo doctor account for local assignment testing.",
      consultationFee: "500.00",
      active: true,
    },
  });

  // Create six future one-hour slots across the next three days.
  const now = new Date();
  const slots = [];

  for (let day = 1; day <= 3; day++) {
    for (const hour of [10, 14]) {
      const startAt = new Date(now);
      startAt.setUTCDate(startAt.getUTCDate() + day);
      startAt.setUTCHours(hour, 0, 0, 0);

      const endAt = new Date(startAt);
      endAt.setUTCHours(endAt.getUTCHours() + 1);

      slots.push({
        doctorId: doctor.id,
        startAt,
        endAt,
        status: "AVAILABLE" as const,
      });
    }
  }

  for (const slot of slots) {
    await prisma.availabilitySlot.upsert({
      where: {
        doctorId_startAt: {
          doctorId: slot.doctorId,
          startAt: slot.startAt,
        },
      },
      update: {},
      create: slot,
    });
  }

  console.log("Demo doctor ready.");
  console.log(`Email: ${email}`);
  console.log(`Doctor ID: ${doctor.id}`);
  console.log("Demo password: supplied through SEED_DOCTOR_PASSWORD");
  console.log("Future availability slots ensured.");
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
