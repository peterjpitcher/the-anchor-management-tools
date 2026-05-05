# Scripts Directory

Operational scripts for data backfills, fixes, debugging, cleanup, and analysis. There are ~240 scripts across TypeScript, JavaScript, and raw SQL files.

## How to Run

**TypeScript scripts:**

```bash
npx tsx scripts/<name>.ts
# or for scripts using path aliases (@/):
npx tsx --tsconfig tsconfig.json scripts/<name>.ts
```

**Mileage route distances:**

```bash
# Show which destination pairs need cached mileage distances. No Google calls.
npm run mileage:distances:routes -- --plan-only --limit 25

# Call Google Routes API and print calculated distances. No database writes.
GOOGLE_ROUTES_API_KEY=... npm run mileage:distances:routes -- --limit 25

# Apply a reviewed batch to mileage_destination_distances.
RUN_MILEAGE_DISTANCE_BACKFILL_MUTATION=true \
ALLOW_MILEAGE_DISTANCE_BACKFILL_MUTATION_SCRIPT=true \
GOOGLE_ROUTES_API_KEY=... \
  npm run mileage:distances:routes -- --confirm --limit 25
```

The mileage script uses Google Maps Platform Routes API `computeRouteMatrix` with
driving routes and traffic-unaware routing for stable distance output. By
default it calculates both directions for every unordered destination pair, then
skips materially asymmetric or unresolved routes instead of guessing a value.
Use `--anchor-only` if you only want Anchor-to-location pairs; omit it for
round-trip mileage between every location. Use `--include-existing` to refresh
cached rows.

**SQL scripts** (run in Supabase SQL Editor or via `psql`):

```bash
# Copy/paste into Supabase Dashboard > SQL Editor
# Or: psql "$DATABASE_URL" < scripts/<name>.sql
```

## Safety Model

Most mutation scripts follow a **dry-run by default** pattern with multi-gating:

1. **Dry-run** (default) -- prints what would happen, writes nothing
2. **Mutation mode** -- requires `--confirm` flag PLUS two environment variables:
   ```bash
   RUN_<SCRIPT_NAME>_MUTATION=true ALLOW_<SCRIPT_NAME>_MUTATION_SCRIPT=true \
     npx tsx scripts/<name>.ts --confirm --limit 10
   ```
3. **Hard caps** -- most scripts enforce a `--limit` with a maximum ceiling

Scripts that call external services (Twilio SMS, Google Calendar, Microsoft Graph) require additional gating flags.

## PRODUCTION WARNING

These scripts connect to whichever database your `.env.local` points at. Most use the **service-role admin client** which bypasses RLS. Always:

- Check your `.env.local` is pointing where you expect
- Run dry-run first
- Use small `--limit` values initially
- Review the script source before running

## Directory Structure

### `analysis/` -- Data Analysis and Reporting (12 scripts)
Read-only scripts for analysing schema, performance, duplicates, user flows, and hiring thresholds. Safe to run -- no mutations.

### `backfill/` -- One-Time Data Migrations (3 scripts)
Backfills for missing data: employee birthdays to calendar, cancelled parking records, parking SMS records. Dry-run by default, multi-gated mutations.

### `cleanup/` -- Data Cleanup and Deletion (16 scripts)
Delete test data, merge duplicate customers, remove stale SMS/messages, purge test bookings and invoices. **Destructive** -- deletes rows. Multi-gated with caps.

### `database/` -- Database Inspection (60+ scripts)
Read-only checks: schema inspection, data validation, status checks across all major tables (bookings, customers, SMS, events, invoices, migrations, permissions, etc.). Safe to run.

### `fixes/` -- One-Time Data Corrections (19 scripts)
Fix specific data issues: broken permissions, duplicate loyalty records, pending payments, SMS template keys, UI prop corrections, RPC functions. Multi-gated mutations.

### `hiring/` -- Hiring Pipeline Tools (1 script)
Cleanup stuck CV processing jobs.

### `menu/` -- Menu Seed Data (7 scripts)
Seed scripts for menu dishes and chef's larder items. Write to the menu tables.

### `oj-projects/` -- OJ Project Management (22 scripts)
Scripts for managing Orange Jelly project entries, Barons pub retainers, and time tracking. Mix of read-only checks and mutations.

### `sms-tools/` -- SMS Operations (9 scripts)
Twilio-related tools: backfill logs, clear stuck jobs, fix past reminders, migrate invite reminders, cleanup phone numbers. **Touches external SMS service** -- extra care required.

### `testing/` -- Test and Debug Utilities (45+ scripts)
Test scripts for verifying integrations: calendar sync, SMS flow, booking API, PDF generation, email, PayPal, loyalty, deployments. Most are read-only probes; some trigger test sends.

### `tools/` -- Reusable Operational Tools (3 scripts)
Higher-value operational scripts: resync private bookings to Google Calendar, repair table booking payment short links, send event review SMS campaigns.

### Root-level TypeScript scripts (~25 scripts)
Miscellaneous one-off scripts: debug bookings/payments, process job queues, import data, seed cashing-up data, verify hiring flows, check employee/booking state.

### Root-level SQL scripts (~24 scripts)
Direct SQL for migrations, permission fixes, RLS policy checks, loyalty migration steps, super-admin grants, and diagnostic queries. Run in the Supabase SQL Editor.

## Categorisation by Risk Level

| Risk | Category | Examples |
|------|----------|---------|
| Safe (read-only) | `analysis/`, `database/`, most `testing/` | Schema checks, data analysis, connectivity tests |
| Low (writes to DB) | `backfill/`, `menu/`, `seed-*` | Inserts new rows, dry-run by default |
| Medium (modifies data) | `fixes/`, `oj-projects/`, root scripts | Updates existing rows, multi-gated |
| High (deletes data) | `cleanup/`, `clear-*` | Deletes rows permanently, multi-gated with caps |
| High (external services) | `sms-tools/`, `tools/send-*` | Sends real SMS or writes to Google Calendar |

## Also: `src/scripts/`

One additional script lives at `src/scripts/import-missed-messages.ts` -- a legacy Twilio message backfill that has been hardened to read-only. For actual message imports, use the authenticated Settings UI instead.
