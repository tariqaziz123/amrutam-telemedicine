# Amrutam Telemedicine API

A TypeScript REST API for a telemedicine platform, supporting patient authentication, doctor availability, consultation booking, consultation lifecycle management, and prescriptions.

## Tech Stack

- Node.js, TypeScript, Express
- PostgreSQL and Prisma ORM
- Redis service provisioned through Docker Compose
- JWT access tokens and rotating refresh tokens
- Zod request validation
- Pino HTTP logging and Helmet security headers
- OpenAPI 3.0 and Swagger UI
- Node.js test runner and Supertest

## Features

- Patient registration, login, token refresh, logout, and profile endpoint
- Role-based access control for patients, doctors, and administrators
- Doctor listing and availability-slot management
- Consultation booking with an idempotency key
- Consultation listing, cancellation, start, and completion
- Prescription creation and authorized retrieval
- Liveness and database-readiness endpoints
- API documentation at `/docs`
- Type checking, build, and automated smoke tests

## Prerequisites

- Node.js and npm
- Docker Desktop
- Git

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local `.env` file. Set `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. Use separate, randomly generated JWT secrets of at least 32 characters. Do not commit `.env`.

3. Start the database services:

   ```bash
   docker compose up -d
   ```

4. Generate the Prisma client and apply migrations:

   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

The API listens on port `3000` by default.

## API Documentation

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`

### Main API Routes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Register a patient |
| POST | `/api/v1/auth/login` | Authenticate |
| POST | `/api/v1/auth/refresh` | Refresh tokens |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET | `/api/v1/auth/me` | Current user profile |
| GET | `/api/v1/doctors` | List doctors |
| GET | `/api/v1/doctors/:doctorId/slots` | View available slots |
| POST | `/api/v1/doctors/:doctorId/slots` | Create slots as the assigned doctor |
| POST | `/api/v1/consultations` | Book a consultation |
| GET | `/api/v1/consultations` | List authorized consultations |
| POST | `/api/v1/consultations/:id/cancel` | Cancel a scheduled consultation |
| POST | `/api/v1/consultations/:id/start` | Start a consultation |
| POST | `/api/v1/consultations/:id/complete` | Complete a consultation |
| POST | `/api/v1/consultations/:id/prescription` | Create a prescription |
| GET | `/api/v1/consultations/:id/prescription` | Retrieve a prescription |

Protected endpoints require `Authorization: Bearer <access-token>`. Consultation booking requires an `Idempotency-Key` header.

## Development Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

## Architecture and Security

The application uses Express route modules, Zod validation, Prisma for PostgreSQL access, and middleware for authentication and security headers. Refresh tokens are stored as hashes, and consultation booking uses a database transaction and an idempotency record.

The local Compose file provisions PostgreSQL and Redis. Redis is available for future caching, rate-limiting, or distributed coordination integration; do not assume application features use Redis unless they are explicitly wired into the code.

## Testing

The smoke tests verify API liveness, database readiness, and rejection of unauthenticated consultation-list requests. Run `npm test` to execute them.

## Limitations

This is an assignment implementation, not a certified clinical system. Email verification, MFA workflows, payment processing, production deployment infrastructure, and comprehensive end-to-end coverage must not be assumed to be implemented unless separately configured and verified.

## License

Assignment submission — add the license required by the project instructions.
