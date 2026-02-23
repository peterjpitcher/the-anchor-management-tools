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
- `/bookings`, `/table-bookings`, `/events`, `/private-bookings` – booking workflows (public creation and internal lifecycle actions).
- `/messages` – outbound SMS and message logs.
- `/invoices`, `/quotes`, `/receipts` – billing and financial documents.
- `/parking` – car park bookings and notification flags.
- `/bug-report` – internal bug reporter endpoint.
- `/cron/*` – background jobs (reminders, parking notifications, etc.).

All endpoints live in `src/app/api/`. Consult the corresponding route file for request/response handling, required permissions, and server runtime.

## Response Conventions (Website Integrations)
- `GET /events` supports optional `search` (or `q`) for text matching across event name, description, slug, and performer.
- `GET /events/{id}` returns the event object as `data` (no nested `event` wrapper); `_meta.lastUpdated` is included for cache diagnostics.
- `POST /events/{id}/check-availability` includes both legacy fields (`available_seats`, `requested_seats`) and normalized capacity fields (`capacity`, `remaining`, `percentage_full`).
- `GET /event-categories` includes `event_count` for upcoming active events (scheduled/draft/rescheduled/postponed).
- `POST /table-bookings` is the only public table-booking endpoint. It requires `Idempotency-Key` and returns `data.state` as one of: `confirmed`, `pending_card_capture`, `pending_payment`, or `blocked`.
- `POST /table-bookings` next-step behavior: when state is `pending_card_capture` or `pending_payment`, `next_step_url` and `hold_expires_at` are returned; when state is `blocked`, `blocked_reason` is returned.

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
