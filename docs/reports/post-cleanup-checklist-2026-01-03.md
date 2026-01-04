# Post-Cleanup Checklist (2026-01-03)

## Migration
- [x] Cleanup migration applied in Supabase
- [ ] Confirm no pending migrations remain (`supabase migration list`)

## Types
- [x] Regenerated Supabase Database types (`src/types/database.generated.ts`)
- [ ] Verify app type imports still compile with the new schema

## RLS / Policies
- [ ] Audit RLS policies for dropped columns/tables (especially `employee_notes` and other cascaded policy drops)
- [ ] Recreate any required policies removed by `CASCADE`

## Smoke Tests
- [ ] Login + dashboard loads
- [ ] Event CRUD
- [ ] Table bookings flow
- [ ] Private bookings flow
- [ ] Parking payments flow
- [ ] Invoices + receipts flow
- [ ] SMS/notifications flow

## Monitoring
- [ ] Check logs for `42703` (missing column) errors
- [ ] Confirm no failing jobs/cron tasks related to removed schema
