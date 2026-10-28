import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { beforeEach, afterEach } from "node:test";
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

describe("Metrics endpoint access", () => {
  const originalToken = process.env.METRICS_TOKEN;

  after(() => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
  });

  it("hides metrics when no token is configured", async () => {
    delete process.env.METRICS_TOKEN;

    const response = await request(app).get("/metrics");

    assert.equal(response.status, 404);
  });

  it("rejects requests without the configured token", async () => {
    process.env.METRICS_TOKEN = "test-only-metrics-token";

    const response = await request(app).get("/metrics");

    assert.equal(response.status, 401);
  });

  it("allows requests with the configured token", async () => {
    process.env.METRICS_TOKEN = "test-only-metrics-token";

    const response = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer test-only-metrics-token");

    assert.equal(response.status, 200);
    assert.match(response.text, /amrutam_http_requests_total/);
  });
});
