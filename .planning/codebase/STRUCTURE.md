# Codebase Structure

**Analysis Date:** 2026-05-18

## Directory Layout

```
OJ-AnchorManagementTools/
├── src/
│   ├── app/                          # Next.js App Router root
│   │   ├── layout.tsx                # Root layout (providers, PWA, SEO)
│   │   ├── page.tsx                  # Root redirect
│   │   ├── globals.css               # Tailwind + global tokens
│   │   ├── (authenticated)/          # Staff management app (auth-gated)
│   │   │   ├── layout.tsx            # Auth guard + permission loading
│   │   │   ├── AuthenticatedLayout.tsx # Client shell with nav/sidebar
│   │   │   ├── dashboard/            # Dashboard module
│   │   │   ├── customers/            # CRM module
│   │   │   ├── employees/            # HR module
│   │   │   ├── events/               # Events module
│   │   │   ├── private-bookings/     # Private bookings module
│   │   │   ├── table-bookings/       # Table bookings module
│   │   │   ├── rota/                 # Staff scheduling module
│   │   │   ├── invoices/             # Invoicing module
│   │   │   ├── mileage/              # Mileage expense tracking
│   │   │   ├── expenses/             # General expense tracking
│   │   │   ├── mgd/                  # Quarterly MGD returns
│   │   │   ├── menu-management/      # Menu & dish management
│   │   │   ├── messages/             # SMS/messaging hub
│   │   │   ├── parking/              # Staff parking management
│   │   │   ├── receipts/             # Receipt management
│   │   │   ├── cashing-up/           # Cash reconciliation
│   │   │   ├── quotes/               # Quotation builder
│   │   │   ├── performers/           # Entertainer management
│   │   │   ├── roles/                # RBAC role management
│   │   │   ├── users/                # User management
│   │   │   ├── settings/             # System settings (15+ sub-sections)
│   │   │   └── oj-projects/          # Internal project tracking
│   │   ├── (staff-portal)/           # Employee self-service (no management perms)
│   │   │   └── portal/               # Shifts, leave, pay
│   │   ├── (timeclock)/              # Public kiosk (no auth)
│   │   │   └── timeclock/            # Clock in/out
│   │   ├── (employee-onboarding)/    # Onboarding flows
│   │   │   └── onboarding/           # New employee wizard
│   │   ├── actions/                  # Server actions (~60 domain files)
│   │   ├── api/
│   │   │   ├── cron/                 # 35+ Vercel Cron job handlers
│   │   │   ├── webhooks/             # paypal/, twilio/ webhook receivers
│   │   │   ├── customers/            # REST-style customer endpoints
│   │   │   ├── events/               # Event export, public APIs
│   │   │   ├── private-bookings/     # Booking API endpoints
│   │   │   ├── quotes/               # Quote PDF generation
│   │   │   └── ...                   # Other endpoint groups
│   │   ├── table-booking/            # Public table booking flow
│   │   ├── parking/guest/            # Public guest parking registration
│   │   ├── booking-portal/           # Customer booking portal
│   │   ├── auth/                     # Login/callback pages
│   │   ├── login/                    # Legacy login redirect
│   │   └── g/ m/ r/                  # Short-link redirect routes
│   ├── services/                     # Domain business logic (class-based)
│   │   ├── customers.ts              # CustomerService
│   │   ├── employees.ts              # EmployeeService
│   │   ├── private-bookings.ts       # PrivateBookingService
│   │   ├── events.ts                 # EventService
│   │   ├── invoices.ts               # InvoiceService
│   │   ├── parking.ts                # ParkingService
│   │   ├── permission.ts             # PermissionService
│   │   ├── receipts/                 # ReceiptService (sub-folder)
│   │   ├── private-bookings/         # Extended booking service sub-folder
│   │   └── ...                       # ~20 domain service files
│   ├── lib/                          # Cross-cutting utilities
│   │   ├── supabase/                 # Supabase clients (server.ts, admin.ts, client.ts)
│   │   ├── email/                    # Microsoft Graph email service
│   │   ├── sms/                      # Twilio SMS wrapper + safety guards
│   │   ├── payments/                 # Payment utilities
│   │   ├── openai/                   # OpenAI wrapper
│   │   ├── rota/                     # Rota calculation utilities
│   │   ├── mileage/                  # HMRC rate calculations
│   │   ├── private-bookings/         # Booking-specific logic
│   │   ├── invoices/                 # Invoice calculation helpers
│   │   ├── menu/                     # Menu utilities
│   │   ├── employees/                # Employee-specific lib helpers
│   │   ├── expenses/                 # Expense processing
│   │   ├── mgd/                      # MGD quarterly return logic
│   │   ├── reminders/                # Reminder scheduling utilities
│   │   ├── cashing-up/               # Cashing-up calculation utilities
│   │   ├── parking/                  # Parking-specific utilities
│   │   ├── table-bookings/           # Table booking utilities
│   │   ├── schemas/                  # Shared Zod schemas
│   │   ├── dateUtils.ts              # London-timezone date helpers
│   │   ├── utils.ts                  # General utilities (fromDb, etc.)
│   │   ├── validation.ts             # Zod validation schemas
│   │   ├── logger.ts                 # Structured logging
│   │   ├── errors.ts                 # Typed error helpers
│   │   ├── retry.ts                  # Retry logic for external calls
│   │   ├── rate-limit.ts             # Rate limiting
│   │   ├── pdf-generator.ts          # PDF generation
│   │   └── ...                       # Many more utility files
│   ├── components/
│   │   ├── ui-v2/                    # Current UI component library
│   │   │   ├── layout/               # PageLayout, PageHeader, Card, Section, Container
│   │   │   ├── navigation/           # HeaderNav, Sidebar, Breadcrumbs, TabNav, AppNavigation.tsx
│   │   │   ├── display/              # Data display components
│   │   │   ├── forms/                # Form primitives
│   │   │   ├── feedback/             # Alerts, toasts, spinners
│   │   │   ├── overlay/              # Modals, drawers
│   │   │   └── index.ts              # Barrel export
│   │   ├── ui/                       # Legacy UI components (being phased out)
│   │   ├── features/                 # Domain-specific shared components
│   │   │   ├── customers/            # Shared customer components
│   │   │   ├── employees/            # Shared employee components
│   │   │   ├── events/               # Shared event components
│   │   │   ├── invoices/             # Shared invoice components
│   │   │   ├── messages/             # Shared messaging components
│   │   │   ├── private-bookings/     # Shared booking components
│   │   │   ├── shared/               # Truly cross-cutting (ServiceWorker, NetworkStatus)
│   │   │   └── ...                   # Other domain feature components
│   │   ├── providers/                # React context providers
│   │   ├── charts/                   # Chart components
│   │   ├── modals/                   # Shared modal components
│   │   └── schedule-calendar/        # Calendar UI component
│   ├── contexts/
│   │   └── PermissionContext.tsx     # RBAC permissions context
│   ├── hooks/                        # Shared custom React hooks
│   │   ├── usePagination.ts
│   │   ├── useSort.ts
│   │   ├── useOutstandingCounts.ts
│   │   └── use-debounce.ts
│   ├── types/                        # TypeScript type definitions
│   │   ├── database.generated.ts     # Auto-generated Supabase types
│   │   ├── database.ts               # Hand-crafted DB types
│   │   ├── rbac.ts                   # RBAC roles, modules, actions
│   │   ├── customers.ts              # Customer domain types
│   │   ├── private-bookings.ts       # Booking domain types
│   │   └── ...                       # Other domain type files
│   ├── middleware.ts                 # Currently disabled (see .disabled copy)
│   └── middleware.ts.disabled        # Disabled middleware (Vercel incident)
├── supabase/
│   ├── migrations/                   # PostgreSQL migration files (timestamped)
│   ├── migrations-archive/           # Old migrations (reference only)
│   └── schema.sql                    # Full schema reference
├── public/                           # Static assets
├── tasks/                            # Task tracking (todo.md, lessons.md)
├── .planning/                        # GSD planning documents
│   └── codebase/                     # Codebase analysis docs
├── vercel.json                       # Vercel cron config + function settings
├── next.config.ts                    # Next.js config
├── tailwind.config.ts                # Tailwind config
└── vitest.config.ts                  # Vitest test config
```

## Directory Purposes

**`src/app/(authenticated)/`:**
- Purpose: All staff management pages, auth-gated at layout level
- Contains: One sub-directory per domain module, each with its own `page.tsx`, `loading.tsx`, `[id]/` dynamic routes, and local `_components/` or inline component files
- Key files: `layout.tsx` (auth guard), `AuthenticatedLayout.tsx` (client shell with sidebar nav)

**`src/app/actions/`:**
- Purpose: All server mutations and complex server-side queries
- Contains: One `.ts` file per domain (customers.ts, events.ts, employees.ts, etc.), all prefixed with `'use server'`
- Key files: `audit.ts` (audit logging), `rbac.ts` (permission checks)

**`src/services/`:**
- Purpose: Business logic and data access, reusable across actions and API routes
- Contains: Class-based services (CustomerService, PrivateBookingService) or module-style files
- Key files: `customers.ts`, `private-bookings.ts`, `employees.ts`, `permission.ts`

**`src/lib/`:**
- Purpose: Cross-cutting utilities, third-party SDK wrappers, calculation helpers
- Contains: Supabase clients, email/SMS/payment wrappers, date utilities, domain-specific sub-folders
- Key files: `dateUtils.ts`, `utils.ts`, `validation.ts`, `supabase/server.ts`, `supabase/admin.ts`

**`src/components/ui-v2/`:**
- Purpose: Current component library — all new UI code must use this
- Contains: Layout primitives, navigation, display, forms, overlays
- Key files: `layout/PageLayout.tsx`, `navigation/HeaderNav.tsx`, `navigation/AppNavigation.tsx`, `index.ts`

**`src/app/api/cron/`:**
- Purpose: Vercel Cron job handlers (35+ jobs)
- Contains: One sub-directory per job, each with a `route.ts`
- Key pattern: All require `Authorization: Bearer CRON_SECRET` validated by `src/lib/cron-auth.ts`

**`supabase/migrations/`:**
- Purpose: Database schema versioning
- Generated: No (hand-written)
- Committed: Yes — naming format `YYYYMMDDHHMMSS_description.sql`

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root Next.js layout (providers, PWA, global CSS)
- `src/app/(authenticated)/layout.tsx`: Auth guard and permission bootstrap
- `src/app/(authenticated)/AuthenticatedLayout.tsx`: Client nav shell
- `src/app/(timeclock)/timeclock/layout.tsx`: Kiosk layout (no auth)

**Configuration:**
- `vercel.json`: Cron schedules and function body size limits
- `next.config.ts`: Next.js configuration
- `tailwind.config.ts`: Tailwind configuration
- `vitest.config.ts`: Test configuration
- `.env.example`: Environment variable documentation

**Core Auth & Permissions:**
- `src/lib/supabase/server.ts`: Cookie-based Supabase client (for user-scoped ops)
- `src/lib/supabase/admin.ts`: Service-role Supabase client (bypasses RLS)
- `src/app/actions/rbac.ts`: `checkUserPermission()` and `getUserPermissions()`
- `src/contexts/PermissionContext.tsx`: Client-side RBAC context provider

**Shared Utilities:**
- `src/lib/dateUtils.ts`: London-timezone date formatting (always use this — never raw `new Date()`)
- `src/lib/utils.ts`: `fromDb<T>()` snake_case→camelCase converter, `formatPhoneForStorage()`
- `src/lib/validation.ts`: Zod schemas for common inputs
- `src/lib/logger.ts`: Structured logging
- `src/lib/email/emailService.ts`: `sendEmail()` via Microsoft Graph
- `src/types/rbac.ts`: All RBAC modules, actions, and role definitions
- `src/types/database.generated.ts`: Auto-generated Supabase type definitions

## Naming Conventions

**Files:**
- Page components: `page.tsx` (always lowercase, required by Next.js)
- Loading states: `loading.tsx` (always lowercase)
- Server components: `PascalCase.tsx` (e.g. `PrivateBookingDetailServer.tsx`)
- Client components: `PascalCase.tsx` with `'use client'` directive; often suffixed `Client` (e.g. `CustomersClient.tsx`, `PrivateBookingDetailClient.tsx`)
- Server actions: `camelCase.ts` domain names (e.g. `customers.ts`, `events.ts`)
- Services: `camelCase.ts` or class files in `PascalCase` within the file

**Directories:**
- Route segments: `kebab-case` (e.g. `private-bookings`, `table-bookings`)
- Local component folders: `_components/` (underscore prefix = private to route)
- Domain sub-directories: `[id]/` for dynamic routes

## Where to Add New Code

**New Management Module (staff-facing):**
- Route: `src/app/(authenticated)/<module-name>/page.tsx`
- Server action: `src/app/actions/<module-name>.ts`
- Service: `src/services/<module-name>.ts`
- Types: `src/types/<module-name>.ts`
- Add to nav: `src/components/ui-v2/navigation/AppNavigation.tsx`
- Add RBAC module: `src/types/rbac.ts`

**New Server Action:**
- File: `src/app/actions/<domain>.ts` (add to existing domain file or create new)
- Always include: `'use server'`, auth check, permission check, `logAuditEvent()`, `revalidatePath()`

**New Cron Job:**
- Route: `src/app/api/cron/<job-name>/route.ts`
- Register: `vercel.json` under `crons`
- Auth guard: use `src/lib/cron-auth.ts`

**New Component:**
- Shared primitive: `src/components/ui-v2/<category>/ComponentName.tsx` + export from `src/components/ui-v2/index.ts`
- Domain-specific shared: `src/components/features/<domain>/ComponentName.tsx`
- Route-local: `src/app/(authenticated)/<module>/_components/ComponentName.tsx`

**Shared Utilities:**
- Domain calculation: `src/lib/<domain>/` sub-folder
- Generic helper: `src/lib/utils.ts` or new file in `src/lib/`
- Date formatting: always use `src/lib/dateUtils.ts`

**Database Migration:**
- Create: `supabase/migrations/YYYYMMDD000000_description.sql`
- Format: timestamp must be after all existing migrations

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents consumed by AI planning commands
- Generated: By AI agents
- Committed: Yes (team reference)

**`tasks/`:**
- Purpose: Task tracking (`todo.md`) and AI self-improvement log (`lessons.md`)
- Generated: By AI agents during task execution
- Committed: Yes

**`supabase/migrations-archive/`:**
- Purpose: Historical migration files moved out of the active migrations path
- Generated: No
- Committed: Yes (reference)

**`.claude/worktrees/`:**
- Purpose: Git worktrees created by Claude agent sessions
- Generated: By Claude agent tooling
- Committed: No (effectively gitignored by their ephemeral nature)

---

*Structure analysis: 2026-05-18*
