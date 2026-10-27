
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

describe("API health checks", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 from the liveness endpoint", async () => {
    const response = await request(app).get("/health/live");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
  });

  it("reports database readiness", async () => {
    const response = await request(app).get("/health/ready");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ready");
  });

  it("rejects unauthenticated consultation requests", async () => {
    const response = await request(app).get("/api/v1/consultations");

    assert.equal(response.status, 401);
  });
});
