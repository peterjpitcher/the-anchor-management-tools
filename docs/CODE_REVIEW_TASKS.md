# Code Review: Changes and Tracking

This is a living checklist derived from the code review. Items are grouped by area and will be updated as work progresses.

## Security & Auth
- [ ] Enforce per-route auth on all relevant `/api` endpoints (session or API key).
- [ ] Ensure Twilio webhook signature verification cannot be disabled in production.
- [ ] Add shared helpers documentation for route handlers using `withApiAuth` and rate limiting.

## Runtime & Infrastructure
- [x] Set Node.js runtime on routes using Puppeteer/Twilio SDKs (avoid edge runtime).
  - [x] `src/app/api/invoices/[id]/pdf/route.ts`
  - [x] `src/app/api/quotes/[id]/pdf/route.ts`
  - [x] `src/app/api/webhooks/twilio/route.ts`
- [ ] Audit any remaining server-side code that must not run on edge (Puppeteer usage paths).

## Supabase & Migrations
- [x] Confirm local migrations are in sync: `supabase db push --dry-run` shows up to date.
- [ ] (Optional) Run `supabase db diff --linked` with Docker shadow DB for deeper verification.
- [ ] Add a pre-merge CI step (gated) to dry-run migrations using Supabase CLI.

## CI/CD & Quality Gates
- [x] Add CI workflow: lint, typecheck, build; optional Supabase dry-run.
  - [x] `.github/workflows/ci.yml` added.
- [ ] Configure repo secrets/vars for optional Supabase dry-run: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `RUN_SUPABASE_DRY_RUN=true`.

## Linting & Code Quality
- [x] Add ESLint guard to prevent importing `@/lib/supabase-singleton` from client components.
- [ ] Reduce lint warnings by removing unused imports/vars in key app pages.
  - [x] Dashboard page cleanup
  - [x] Employees pages cleanup
  - [x] Events pages cleanup
  - [x] Invoices pages cleanup
  - [x] Customers pages cleanup
- [x] Remove VIP/Loyalty section from app (routes, nav)
  - [ ] Table bookings actions cleanup (remove unused imports/vars)
- [ ] Gradually replace `any` types in hot paths with concrete types.

## Testing
- [ ] Add minimal Playwright config and 2–3 smoke tests (auth + key CRUD flows).
- [ ] Document how to run E2E locally and in CI.

## Documentation
- [ ] Document API auth patterns (session vs API key vs cron bearer) for route authors.
- [ ] Add a short note on when to use Node runtime vs default.

---

## Completed Changes (Detail)

1) Node runtime set for PDF and Twilio webhook routes to ensure compatibility with Puppeteer/Twilio SDKs.
2) ESLint boundary rule added to block importing the Supabase singleton in client components.
3) CI workflow added with lint, typecheck, build, and optional Supabase migration dry-run.
4) Supabase migrations verified: remote database is up to date.
