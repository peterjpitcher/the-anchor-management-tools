---
title: "Operations MOC"
aliases:
  - "Operations"
  - "Ops"
  - "Infrastructure"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Operations — Map of Content

← [[Home]]

## Notes in This Section

- [[Cron Jobs]] — Scheduled background tasks (Vercel crons)
- [[Webhooks]] — Inbound webhooks from Twilio, Stripe, PayPal
- [[Environment Variables]] — All required env vars with descriptions

---

## Quick Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # ESLint (zero warnings enforced)
npm test             # Run Vitest tests
npx supabase db push # Apply pending migrations
```

---

```dataview
LIST
FROM "OJ-AnchorManagementTools/40-Operations"
WHERE type != "moc"
SORT file.name ASC
```
