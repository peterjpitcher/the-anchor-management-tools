# Architecture

**Analysis Date:** 2026-05-18

## Pattern Overview

**Overall:** Modular monolith — Next.js 15 App Router with server-first rendering, domain-scoped server actions, and a layered service architecture.

**Key Characteristics:**
- Server Components as default; `'use client'` only for interactivity, forms, and browser APIs
- All mutations go through `'use server'` actions in `src/app/actions/`; direct DB access from pages is server-only and read-focused
- Business logic lives in `src/services/` (domain services) and `src/lib/` (cross-cutting utilities), not in route handlers or components
- Auth enforced at layout level (middleware disabled); RBAC enforced server-side in every action
- Comprehensive audit logging via `logAuditEvent()` on every mutation

## Layers

**Presentation Layer:**
- Purpose: Render UI, handle user events, call server actions
- Location: `src/app/(authenticated)/**/*.tsx`, `src/components/`
- Contains: Server Components (pages, layouts), Client Components (`*Client.tsx`), modal components
- Depends on: Server actions, context, hooks
- Used by: End users (browser)

**Server Actions Layer:**
- Purpose: Handle all mutations, enforce auth/RBAC, coordinate business logic, revalidate cache
- Location: `src/app/actions/` (~60+ action files, one per domain)
- Contains: `'use server'` functions that validate input, check permissions, call services, log audit events, and call `revalidatePath()`
- Depends on: Services layer, lib utilities, Supabase clients
- Used by: Client components (via Next.js Server Actions RPC)

**Services Layer:**
- Purpose: Domain business logic, data access encapsulation, complex queries
- Location: `src/services/` (flat files: `customers.ts`, `employees.ts`, `private-bookings.ts`, `parking.ts`, etc.)
- Contains: Class-based services (e.g. `CustomerService`, `PrivateBookingService`) with methods that query Supabase directly
- Depends on: Supabase clients, lib utilities, type definitions
- Used by: Server actions, cron routes, API routes

**Lib Layer:**
- Purpose: Cross-cutting utilities and integration wrappers
- Location: `src/lib/` (large flat directory + domain sub-folders)
- Contains: Supabase clients, email service, SMS service, PDF generator, date utilities, validation schemas, payments, OpenAI wrappers, rate limiting
- Depends on: External SDKs (Twilio, Microsoft Graph, Stripe, PayPal, OpenAI)
- Used by: Services, server actions, API routes, cron jobs

**API Routes:**
- Purpose: Webhooks, public-facing APIs, cron triggers
- Location: `src/app/api/`
- Contains: Webhook handlers (`/webhooks/paypal`, `/webhooks/twilio`), cron jobs (`/cron/*` — 35+ scheduled jobs), public/external endpoints
- Depends on: Services, lib utilities
- Used by: External services (Twilio, PayPal webhooks), Vercel Cron scheduler

**Type Layer:**
- Purpose: Shared TypeScript interfaces
- Location: `src/types/` (flat files: `database.ts`, `database.generated.ts`, `rbac.ts`, `customers.ts`, etc.)
- Contains: DB row types, domain model types, RBAC types, generated Supabase types
- Depends on: Nothing (pure types)
- Used by: All other layers

## Data Flow

**Mutation (e.g. create customer):**

1. User submits form in `CustomersClient.tsx` (client component)
2. Client component calls server action `createCustomer()` from `src/app/actions/customers.ts`
3. Server action: calls `createClient()`, calls `supabase.auth.getUser()` to verify session
4. Server action: calls `checkUserPermission('customers', 'create', userId)` from `src/app/actions/rbac.ts`
5. Server action: validates input with Zod schema from `src/lib/validation.ts`
6. Server action: calls `CustomerService.createCustomer()` from `src/services/customers.ts`
7. Service: writes to Supabase DB via anon client (respects RLS) or admin client (bypasses RLS for system ops)
8. Server action: calls `logAuditEvent()` from `src/app/actions/audit.ts`
9. Server action: calls `revalidatePath('/customers')` to bust cache
10. Returns `{ success: true }` or `{ error: string }` to client

**Read (e.g. dashboard):**

1. `dashboard/page.tsx` (server component) imports `dashboard-data.ts`
2. `dashboard-data.ts` calls `unstable_cache()` wrapping Supabase queries
3. Data returned as typed objects to the server component
4. Server component passes data as props to client sub-components

**Scheduled Jobs (cron):**

1. Vercel Cron calls `/api/cron/<job-name>` with `Authorization: Bearer CRON_SECRET`
2. Route handler validates `CRON_SECRET` via `src/lib/cron-auth.ts`
3. Handler calls service methods directly (uses admin client where needed)
4. Job results logged via `src/lib/cron-run-results.ts`

**State Management:**
- Server state via Supabase + Next.js cache (`unstable_cache`, `revalidatePath`, `revalidateTag`)
- Client state via React Context: `PermissionContext` (`src/contexts/PermissionContext.tsx`) provides RBAC data to all client components without prop drilling
- Form state via React Hook Form (where configured)
- No Redux, Zustand, or global client state stores

## Key Abstractions

**PermissionContext:**
- Purpose: Expose pre-loaded RBAC permissions to all client components without repeated server round-trips
- Location: `src/contexts/PermissionContext.tsx`
- Pattern: Seeded at layout level with `initialPermissions` from server, consumed by client components to show/hide UI elements

**ServerAction Return Type:**
- Purpose: Consistent mutation response shape
- Pattern: `Promise<{ success?: boolean; error?: string; data?: T }>` across all action files

**Supabase Dual-Client:**
- Purpose: Cookie-based client for user-scoped operations (respects RLS); admin/service-role client for system operations
- Location: `src/lib/supabase/server.ts` (anon+cookie), `src/lib/supabase/admin.ts` (service role)

**Domain Services:**
- Purpose: Encapsulate complex multi-step business operations, reusable across server actions and API routes
- Examples: `src/services/customers.ts` (CustomerService), `src/services/private-bookings.ts` (PrivateBookingService), `src/services/employees.ts` (EmployeeService)
- Pattern: Class with static or instance methods; direct Supabase queries; no HTTP calls

**Domain Lib Modules:**
- Purpose: Complex domain logic that doesn't fit services (calculations, templates, external calls)
- Examples: `src/lib/rota/`, `src/lib/mileage/`, `src/lib/private-bookings/`, `src/lib/invoices/`, `src/lib/menu/`
- Pattern: Flat function exports or small focused files

## Entry Points

**Staff Management App:**
- Location: `src/app/(authenticated)/layout.tsx`
- Triggers: Any request under `/` (authenticated paths)
- Responsibilities: Auth guard (`supabase.auth.getUser()`), permission loading (`getUserPermissions()`), portal redirect for non-management staff

**Public Table Booking:**
- Location: `src/app/table-booking/`
- Triggers: Customer visits booking URL
- Responsibilities: Public form, token-based confirmation, no auth required

**Parking Guest Portal:**
- Location: `src/app/parking/guest/`
- Triggers: Guest visits parking link
- Responsibilities: Public parking registration flow

**Staff Portal:**
- Location: `src/app/(staff-portal)/portal/`
- Triggers: Staff-only employees log in
- Responsibilities: Shift view, leave requests, payroll — no management access

**Time Clock Kiosk:**
- Location: `src/app/(timeclock)/timeclock/`
- Triggers: Kiosk device access (no auth)
- Responsibilities: Clock in/out for employees

**Root App Layout:**
- Location: `src/app/layout.tsx`
- Responsibilities: Global providers (Supabase session, Toaster), PWA manifest, SEO robot blocking, service worker registration

## Error Handling

**Strategy:** Return-value errors for server actions; thrown errors for catastrophic failures; error boundaries at page level

**Patterns:**
- Server actions return `{ error: string }` for expected failures (validation, permission denied, not found)
- Server actions throw for unexpected failures (let Next.js error boundary catch)
- `src/lib/errors.ts` contains typed error helpers
- `src/lib/dbErrorHandler.ts` normalises Supabase DB errors
- `src/lib/retry.ts` wraps flaky external calls (SMS, email) with retry logic
- `src/lib/supabase-retry.ts` adds retry wrapper for Supabase queries
- `error.tsx` files at route group level catch rendering errors

## Cross-Cutting Concerns

**Logging:** `src/lib/logger.ts` — structured console logging; audit trail via `logAuditEvent()` (`src/app/actions/audit.ts`) written to Supabase `audit_log` table on every mutation

**Validation:** Zod schemas in `src/lib/validation.ts` and `src/lib/schemas/`; validated in server actions before any DB write

**Authentication:** Supabase Auth + JWT + HTTP-only cookies; `createClient()` from `src/lib/supabase/server.ts`; checked in `(authenticated)/layout.tsx` and re-checked in every server action

**RBAC:** `checkUserPermission(module, action, userId)` from `src/app/actions/rbac.ts`; roles defined in `src/types/rbac.ts`; permissions seeded into React context at layout level for UI gating

**Rate Limiting:** `src/lib/rate-limit.ts` / `src/lib/rate-limiter.ts` — applied on SMS sending and public endpoints; SMS safety guards in `src/lib/sms/safety.ts`

**Caching:** `unstable_cache` for dashboard and expensive reads; `revalidatePath`/`revalidateTag` called in server actions after mutations

---

*Architecture analysis: 2026-05-18*
