# Ticket release database verification

Both approved migrations were applied to production project `tfcasgxopxegwrabvwat` on 10 September 2026. Original SQL filenames and approved contents are retained.

| Repository migration | Production history version | SHA-256 |
| --- | --- | --- |
| `20260910065400_ticket_setup_and_attendees.sql` | `20260910075712` | `3c932cde7891ed338c8fcd548343b285d96d0ce804d6db84d002c8b1ab28ee21` |
| `20260910073920_ticket_attendees_dining_requests.sql` | `20260910075719` | `70d663e10124565c2900d592d2e57f424cecf80b9d772ca7e57ae84db79fbca8` |

The release agent confirmed all catalogue checks passed: four columns, eleven functions with execution permissions and search paths, seven triggers and two constraints. Hashes of `customer_communications`, `recent_reminder_activity` and `reminder_timing_debug` stayed unchanged. The anonymous surface assertion passed all nine checks.

The extended production smoke passed with every synthetic record rolled back. It covered paid holds, attendee snapshots, invalid guest counts and missing required answers, changed-price rollback, dining and early-arrival notes, conflict retries, discount expiry, preservation of existing hold prices, price/name mirrors, last-ticket and attendee-count guards, and ordinary free/pay-on-arrival bookings without guest fields. No payment or customer communication was sent.

`src/types/database.generated.ts` was reconciled against the exact post-apply Supabase generation saved at `/tmp/ticket-live-database.generated.ts`. Only the four ticket columns in Row/Insert/Update and the two new callable booking functions were copied. Trigger functions are not exposed in generated types. Existing unrelated schema drift was deliberately excluded.

After this scoped type reconciliation, `npx tsc --noEmit` and `npm run lint` both passed. This is a types and verification-record update, with no runtime behaviour change.

Application deployment IDs and browser verification are recorded by the release agent separately when complete.
