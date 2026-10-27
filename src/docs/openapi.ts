
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Amrutam Telemedicine API",
    version: "1.0.0",
    description:
      "REST API for patient authentication, doctor availability, consultations, and prescriptions.",
  },
  servers: [{ url: "/api/v1", description: "API v1" }],
  tags: [
    { name: "Health" },
    { name: "Authentication" },
    { name: "Doctors" },
    { name: "Consultations" },
    { name: "Prescriptions" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/health/live": {
      get: {
        tags: ["Health"],
        summary: "Check whether the API process is alive",
        responses: {
          "200": { description: "API is alive" },
        },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Check database readiness",
        responses: {
          "200": { description: "Database is reachable" },
          "503": { description: "Database is unavailable" },
        },
      },
    },
    "/auth/register": {
      post: {
        tags: ["Authentication"],
        summary: "Register a patient account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password", minLength: 8 },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Patient registered" },
          "400": { description: "Invalid request" },
          "409": { description: "Account already exists" },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Authentication"],
        summary: "Authenticate a user",
        responses: {
          "200": { description: "Tokens returned" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/doctors": {
      get: {
        tags: ["Doctors"],
        summary: "List doctors",
        parameters: [
          {
            name: "specialty",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          "200": { description: "Paginated doctor list" },
        },
      },
    },
    "/doctors/{doctorId}/slots": {
      get: {
        tags: ["Doctors"],
        summary: "List available doctor slots",
        parameters: [
          {
            name: "doctorId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Available slots returned" },
        },
      },
    },
    "/consultations": {
      get: {
        tags: ["Consultations"],
        summary: "List consultations for the authenticated user",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Consultations returned" },
          "401": { description: "Authentication required" },
        },
      },
      post: {
        tags: ["Consultations"],
        summary: "Book a consultation",
        description: "Requires a unique Idempotency-Key request header.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 255 },
          },
        ],
        responses: {
          "201": { description: "Consultation booked" },
          "401": { description: "Authentication required" },
          "409": { description: "Slot unavailable or idempotency conflict" },
        },
      },
    },
    "/consultations/{id}/cancel": {
      post: {
        tags: ["Consultations"],
        summary: "Cancel a scheduled consultation",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Consultation cancelled" },
          "401": { description: "Authentication required" },
          "404": { description: "Consultation not found" },
          "409": { description: "Consultation cannot be cancelled" },
        },
      },
    },
    "/consultations/{id}/start": {
      post: {
        tags: ["Consultations"],
        summary: "Start a consultation (assigned doctor only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Consultation started" },
          "403": { description: "Doctor not assigned to consultation" },
        },
      },
    },
    "/consultations/{id}/complete": {
      post: {
        tags: ["Consultations"],
        summary: "Complete an in-progress consultation",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Consultation completed" },
          "403": { description: "Doctor not assigned to consultation" },
        },
      },
    },
    "/consultations/{id}/prescription": {
      get: {
        tags: ["Prescriptions"],
        summary: "Get a consultation prescription",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Prescription returned" },
          "404": { description: "Prescription not found" },
        },
      },
      post: {
        tags: ["Prescriptions"],
        summary: "Create a prescription (assigned doctor only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "201": { description: "Prescription created" },
          "403": { description: "Doctor not assigned to consultation" },
          "409": { description: "Consultation not completed or prescription exists" },
        },
      },
    },
  },
} as const;
