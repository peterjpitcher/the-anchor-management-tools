---
title: "Tech Stack"
aliases:
  - "Stack"
  - "Technology"
  - "Frameworks"
tags:
  - type/reference
  - status/active
module: architecture
created: 2026-03-14
updated: 2026-03-14
---

# Tech Stack

← [[Architecture MOC]]

## Core Framework

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router | 15 |
| UI Library | React | 19 |
| Language | TypeScript | Strict mode |
| Styling | Tailwind CSS | v4 |
| Database | Supabase (PostgreSQL + Auth + RLS) | — |
| Hosting | Vercel | — |

---

## Key Libraries

### UI & Forms
- **React Hook Form** + **Zod** — form validation
- **Radix UI** — accessible primitives (via `components.json` — shadcn/ui pattern)
- **Lucide React** — icons

### Data & State
- **Supabase JS** (`@supabase/ssr`) — database client with cookie-based auth
- **Server Actions** — all mutations use `'use server'` functions

### Integrations
- **Twilio** — SMS (`src/lib/twilio.ts`, `src/lib/sms/`)
- **Microsoft Graph** — Email (`src/lib/microsoft-graph.ts`)
- **OpenAI** — AI classification (`src/lib/openai.ts`)
- **Stripe** — Card payments (`src/lib/payments/stripe.ts`)
- **PayPal** — PayPal payments (`src/lib/paypal.ts`)

### Utilities
- **libphonenumber-js** — E.164 phone number normalisation
- **Puppeteer** — PDF generation for invoices and contracts
- **date-fns** — Date manipulation (always via `src/lib/dateUtils.ts` wrapper)

### Testing
- **Vitest** — Unit and integration tests
- **Playwright** — E2E tests (config: `.playwright-mcp/`)

---

## Component Architecture

```
src/
├── app/                     # Next.js routes (App Router)
│   ├── (authenticated)/     # Protected staff portal
│   ├── (staff-portal)/      # Employee self-service
│   ├── (timeclock)/         # Public kiosk
│   ├── auth/                # Auth flows
│   └── api/                 # Route handlers + webhooks
├── components/
│   ├── ui-v2/               # Design system (HeaderNav, PageLayout, etc.)
│   └── features/            # Feature-specific components
├── services/                # Business logic (22 services)
├── lib/                     # Infrastructure wrappers
├── types/                   # TypeScript interfaces
├── hooks/                   # React hooks
├── contexts/                # Auth, permissions contexts
└── actions/                 # Server actions (mutations)
```

---

## Design Patterns

> [!TIP] Server Components First
> Default to Server Components. Add `'use client'` only when you need interactivity, hooks, or browser APIs.

> [!TIP] Server Actions for Mutations
> All writes use `'use server'` functions returning `Promise<{ success?: boolean; error?: string }>`.

> [!TIP] Service Layer
> Business logic lives in `src/services/`, not in route handlers or components.

---

## Related
- [[Database Schema]]
- [[Auth & Security]]
- [[Deployment & Infrastructure]]
