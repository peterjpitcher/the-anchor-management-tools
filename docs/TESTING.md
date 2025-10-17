# Testing Guide

The project does not currently ship automated tests; most validation is performed through linting, type checking, and targeted manual smoke tests. This guide explains the expectations today and how to extend coverage responsibly.

## Current Workflow
- `npm run lint` runs ESLint with TypeScript type checking. This is required before every PR.
- `npm run build` validates that the Next.js build and route bundling succeed.
- Manual smoke testing is expected for the area you touched (log in, exercise the feature, verify audit logs/SMS when applicable).
- Production incidents should be captured through the in-app bug reporter or `/api/bug-report` to keep an auditable trail.

## Recommended Smoke Tests
Run through the flows that match your change:
- **Authentication**: sign in/out and confirm the correct redirect flow.
- **Bookings**: create and update events, table bookings, and verify the SMS reminder queue.
- **Invoices**: generate an invoice PDF, email it using Microsoft Graph test credentials, and record a payment.
- **Parking**: create a booking, trigger the reminder cron, and confirm status updates.

Document any manual steps you performed in the pull request description.

## Adding Automated Coverage
When you introduce automated tests:
- Place Playwright specs under `tests/` with `.spec.ts` filenames.
- Keep suites short and deterministic (authentication, booking creation, invoice lifecycle).
- Use environment variables for secrets; never hard-code credentials.
- Update this guide with the commands required to run the new suites (e.g., `npx playwright test`).

Future work should consider:
- Lightweight Vitest suites for pure utilities in `src/lib/`.
- Playwright smoke tests for the primary authenticated workflow (login → dashboard → bookings/invoices).
- Cron endpoint assertions to ensure reminder queues stay consistent.

Until automated coverage exists, thorough manual testing and clear test notes in PRs remain mandatory.
