---
title: "Deployment & Infrastructure"
aliases:
  - "Deployment"
  - "Infrastructure"
  - "Vercel"
  - "Hosting"
tags:
  - type/reference
  - status/active
module: architecture
created: 2026-03-14
updated: 2026-03-14
---

# Deployment & Infrastructure

← [[Architecture MOC]]

---

## Hosting

| Service | Purpose |
|---|---|
| **Vercel** | Next.js hosting, serverless functions, cron jobs |
| **Supabase** | PostgreSQL database, Auth, Row Level Security, file storage |

---

## Vercel Configuration

Config file: `vercel.json`

### Scheduled Cron Jobs

| Route | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/parking-notifications` | `0 5 * * *` (5am daily) | Send parking reminder SMS |
| `/api/cron/rota-auto-close` | `0 5 * * *` (5am daily) | Auto-close completed rotas |
| `/api/cron/rota-manager-alert` | `0 18 * * 0` (6pm Sundays) | Weekly manager summary email |
| `/api/cron/rota-staff-email` | `0 21 * * 0` (9pm Sundays) | Weekly staff schedule email |

All cron endpoints require: `Authorization: Bearer <CRON_SECRET>`

→ See [[Cron Jobs]] for full detail.

---

## Body Size Limit

Server actions are configured with a **20 MB** body size limit to support file uploads (receipts, employee attachments, PDFs).

---

## Build Commands

```bash
npm run build     # Production build (must pass before deploy)
npm run lint      # ESLint — zero warnings enforced
npx tsc --noEmit  # Type check
npm test          # Vitest tests
```

---

## Supabase Storage

Used for:
- Private booking contracts and documents (`private_booking_documents`)
- Employee attachments (certificates, right-to-work docs)
- Receipt scan uploads

---

## Environment Variables

→ See [[Environment Variables]] for the full list.

Key groups:
- Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`)
- Microsoft (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`)
- Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- PayPal (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`)
- OpenAI (`OPENAI_API_KEY`)
- App (`NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `PAYROLL_ACCOUNTANT_EMAIL`)

---

## Related
- [[Cron Jobs]]
- [[Webhooks]]
- [[Environment Variables]]
- [[Tech Stack]]
