
import express, {
  type ErrorRequestHandler,
} from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./docs/openapi.js";
import { prisma } from "./config/prisma.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { doctorRouter } from "./modules/doctors/doctor.routes.js";
import { consultationRouter } from "./modules/consultations/consultation.routes.js";
import { prescriptionRouter } from "./modules/consultations/prescription.routes.js";
import {
  httpRequestDuration,
  httpRequestsTotal,
  metricsRegistry,
} from "./config/metrics.js";

export const app = express();

app.disable("x-powered-by");

app.use(
  pinoHttp({
    genReqId: (req, res) => {
      const id = randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
    ],
  }),
);

app.use(helmet());

const allowedOrigins = (
  process.env.CORS_ORIGIN ?? "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    // Use the matched route template, never the raw URL or its IDs.
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : "unmatched";

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);

    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1e9;

    httpRequestDuration.observe(labels, durationSeconds);
  });

  next();
});

app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ready",
      dependencies: {
        postgres: "connected",
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/doctors", doctorRouter);
app.use("/api/v1/consultations", consultationRouter);
app.use("/api/v1/consultations", prescriptionRouter);

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/openapi.json", (_req, res) => res.json(openApiSpec));


app.get("/metrics", async (req, res, next) => {
  const metricsToken = process.env.METRICS_TOKEN;
  const authorization = req.get("authorization");

  if (!metricsToken) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
    return;
  }

  if (authorization !== `Bearer ${metricsToken}`) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Metrics authentication required",
      },
    });
    return;
  }

  try {
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.status(200).send(await metricsRegistry.metrics());
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Resource not found",
    },
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  _next,
) => {
  req.log.error(
    { err: error, requestId: req.id },
    "Request failed",
  );

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId: req.id,
    },
  });
};

app.use(errorHandler);
