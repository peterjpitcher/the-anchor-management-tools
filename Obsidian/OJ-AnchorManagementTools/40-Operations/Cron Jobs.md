---
title: Cron Jobs
aliases:
  - scheduled jobs
  - cron
tags:
  - type/reference
  - section/operations
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Operations MOC]]

# Cron Jobs

All scheduled jobs are defined in `vercel.json` and run as Vercel serverless functions on a cron schedule. Each endpoint is protected by a bearer token to prevent unauthorised triggering.

## Authentication

All cron endpoints require:

```
Authorization: Bearer <CRON_SECRET>
```

The `CRON_SECRET` environment variable is set in Vercel's environment configuration. Requests without a valid bearer token return `401`.

> [!WARNING] Never Expose CRON_SECRET
> The `CRON_SECRET` value must never appear in client-side code, logs, or public repositories. It is a server-only secret.

## Scheduled Jobs

| Route | Schedule (UTC) | Approx Local Time | Purpose |
|---|---|---|---|
| `/api/cron/parking-notifications` | `0 5 * * *` | 5am daily | Send parking reminder SMS to guests with upcoming bookings |
| `/api/cron/rota-auto-close` | `0 5 * * *` | 5am daily | Auto-close completed and past rotas |
| `/api/cron/rota-manager-alert` | `0 18 * * 0` | 6pm Sundays | Email the manager a weekly rota summary |
| `/api/cron/rota-staff-email` | `0 21 * * 0` | 9pm Sundays | Email each staff member their upcoming week schedule |

> [!NOTE] UK Local Time
> Schedules are defined in UTC. During British Summer Time (BST, UTC+1), the effective local time shifts by one hour. A job at `0 5 * * *` UTC runs at 5am GMT or 6am BST.

## Job Details

### `/api/cron/parking-notifications`

Sends SMS reminders to guests who have parking booked for upcoming dates. Uses [[Twilio]] for delivery. Respects [[SMS Policy]] opt-in checks and rate limits.

### `/api/cron/rota-auto-close`

Scans open rotas and automatically closes any that cover periods that have now passed. Prevents staff from submitting availability on outdated rotas. See [[Rota]].

### `/api/cron/rota-manager-alert`

Sends a weekly email to the manager summarising the upcoming rota — outstanding availability gaps, uncovered shifts, etc. Delivered via [[Microsoft Graph]].

### `/api/cron/rota-staff-email`

Sends each active staff member an email with their confirmed shifts for the coming week. Delivered via [[Microsoft Graph]].

## Implementation Pattern

> [!TIP] Thin Handlers
> Cron handler functions are intentionally thin — they authenticate the request, then delegate to the service layer. Business logic lives in services, not in cron route files. This keeps cron handlers testable and the logic reusable.

Example structure:

```typescript
// /api/cron/parking-notifications/route.ts
export async function GET(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (token !== process.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 });

  await parkingNotificationService.sendUpcomingReminders();
  return new Response('OK');
}
```

## Related

- [[Operations MOC]]
- [[Parking]]
- [[Rota]]
- [[Twilio]]
- [[Microsoft Graph]]
- [[Environment Variables]]
- [[Deployment & Infrastructure]]
