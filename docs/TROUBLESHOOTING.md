# Troubleshooting Guide

Use this guide to diagnose common production or staging issues. Each section references real scripts or utilities in the repository.

## Quick Diagnostics
- `npm run lint` – first pass for build and type errors.
- `npm run build` – verifies Next.js can compile all routes.
- `supabase db push --dry-run` – check for pending migrations (requires Supabase CLI auth).
- Run the SQL in `scripts/check-rls-policies.sql` through the Supabase SQL editor to confirm RLS policies.
- `tsx scripts/sms-tools/check-all-jobs.ts` – inspect the background job queue summary. Requires valid Supabase service role credentials in environment variables.

Always capture command output in the incident ticket or PR you are preparing.

## Authentication Problems
**Symptoms**: users loop back to the login page, Supabase returns 401s, or sessions expire unexpectedly.

1. Verify the Supabase environment variables in Vercel or `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
2. Check Supabase auth logs for the affected user (`auth.users` table → `last_sign_in_at`). If tokens are revoked, ask the user to log out and sign in again.
3. Ensure the middleware is running in Node runtime (default). If you changed it, revert to avoid cookie refresh issues.
4. If password recovery links fail, confirm the redirect whitelist includes `/auth/recover` (see **Security** guide) and ask the user for the full reset URL to confirm the token is intact.

## Database & Migrations
**Symptoms**: “relation does not exist”, RLS errors, or CRUD operations failing.

1. Check migration status with `supabase migration list`.
2. Run `supabase db push --dry-run` to confirm local SQL matches remote.
3. Inspect `supabase/migrations-backup/` for the original SQL when diagnosing legacy schema changes.
4. Verify RLS policies using `scripts/check-rls-policies.sql`; mismatched policies are a common cause of write failures.
5. When new tables or policies are added, document them in the PR and update [docs/SECURITY.md](./SECURITY.md) if roles or permissions change.

## SMS & Reminder Issues
**Symptoms**: duplicate reminders, missing confirmations, or stalled jobs.

1. `tsx scripts/sms-tools/check-reminder-issues.ts` – lists overdue or duplicate reminders.
2. `tsx scripts/sms-tools/clear-stuck-jobs.ts` – clears failed jobs (only run with production approval).
3. Review the cron logs in Vercel for `/api/cron/reminders`; ensure the “scheduled pipeline” run completed.
4. Cross-check the reminder configuration in [docs/sms-reminder-pipeline.md](./sms-reminder-pipeline.md) before altering templates or cadence.

## Email & PDF Generation
**Symptoms**: invoice emails fail, PDFs not generated.

1. Confirm Microsoft Graph credentials (`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_USER_EMAIL`) are present.
2. Ensure routes that use Puppeteer are forced onto the Node runtime (`runtime = 'nodejs'`); edge runtime cannot execute Chromium.
3. Tail logs for `/api/invoices/[id]/pdf` or `/api/quotes/[id]/pdf` in Vercel; failures usually include Puppeteer path errors.

## Build & Deployment Failures
**Symptoms**: Vercel deploy fails, CI build red.

1. Run `npm run lint` locally to reproduce ESLint/TypeScript failures.
2. Review `.github/workflows/ci.yml` for the failing step (lint, type-check, build, optional Supabase dry-run).
3. Confirm Node.js version in CI matches `20.x`.
4. Check GitHub secrets for `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and other required values (see [docs/setup/GITHUB_SECRETS_SETUP.md](./setup/GITHUB_SECRETS_SETUP.md)).

## When to Escalate
- Multiple users affected with no apparent configuration drift.
- Database changes missing in source control.
- Suspicious access attempts or security anomalies (update [docs/SECURITY.md](./SECURITY.md) after response).
- Third-party outages (Twilio, Supabase, Microsoft) impacting all environments.

Record timelines, affected users, commands run, and resolution steps in the incident ticket or PR. This keeps operational knowledge centralised and reduces duplicated work.
