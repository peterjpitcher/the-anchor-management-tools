# API Overview

The Anchor Management Tools exposes a set of authenticated API routes under `/api`. Use this guide as the canonical entry point for external integrations.

## Getting Started
- **Base URLs**
  - Production: `https://management.orangejelly.co.uk/api`
  - Local development: `http://localhost:3000/api`
- **Authentication**
  - Staff-facing routes rely on Supabase sessions (bearer JWT acquired via login).
  - Machine-to-machine flows (cron, external partners) use a Bearer token or API key as documented per route.
  - Cron routes expect `Authorization: Bearer <CRON_SECRET>`.
- **Rate limits** (default unless otherwise noted)
  - Standard routes: 100 requests/minute.
  - SMS and reminder endpoints: 10 requests/minute.
  - Bulk operations: 5 requests/minute.

## Key Domains
- `/bookings`, `/table-bookings`, `/events`, `/private-bookings` – booking workflows (creation, confirmation, cancellation).
- `/messages` – outbound SMS and message logs.
- `/invoices`, `/quotes`, `/receipts` – billing and financial documents.
- `/parking` – car park bookings and notification flags.
- `/bug-report` – internal bug reporter endpoint.
- `/cron/*` – background jobs (reminders, parking notifications, etc.).

All endpoints live in `src/app/api/`. Consult the corresponding route file for request/response handling, required permissions, and server runtime.

## OpenAPI Specification
- `docs/guides/api/openapi.yaml` contains the full OpenAPI 3.0 spec. Import it into Postman/Insomnia/Swagger UI for schema validation, example payloads, and response codes.
- Regenerate the spec whenever you ship new endpoints or change request/response models.

## Building Integrations
1. Obtain an API key or service credential from the Anchor operations team.
2. Review the relevant route handler under `src/app/api/` to understand business logic and required headers.
3. Use the OpenAPI spec for request samples and to generate client SDKs if needed.
4. Document integrations in your PR and update this overview if you expose new public endpoints or change authentication requirements.

## Support
- Internal users should raise issues through the in-app bug reporter.
- External integrators can reach the team at `manager@the-anchor.pub`.
- Security concerns: follow the disclosure process defined in [docs/SECURITY.md](../../SECURITY.md).
