# Verification evidence

Local only. No production migration, deploy, real charge ending or manual invoice send.

- `npm run lint`: exit 0, no warnings.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`: exit 0.
- `npm run typecheck:tests`: exit 0.
- `npm test -- --maxWorkers=4`: exit 0. Output: `Test Files 1161 passed (1161)` and `Tests 10929 passed | 2 skipped (10931)`.
- `npm run test:utc -- --maxWorkers=4`: exit 0, same passing counts.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run build`: exit 0. Output: `Compiled successfully in 56s`; route manifest emitted.
- `npx tsx scripts/security/assert-anon-surface.ts`: exit 0. Output: `all 9 checks passed`.
- Isolated PostgreSQL assertions and real reissue smoke: exit 0. All smoke changes rolled back.
- Concurrent sessions output: `PASS: billing waits for closure and then sees the ended definition`; `PASS: closure waits for billing and refuses without changing the charge`; `PASS: actual anon role cannot execute the closure RPC`.
- Rollback success before use: exit 0. After use: `PASS: rollback refuses after first use and preserves ended charge data`.
- `git diff --check`: exit 0.

The initial page guard caught a direct toast import in the new modal. It was changed to the design-system export; both full suites then passed. The initial plain app typecheck exceeded its default heap; the documented check completed with an 8 GB heap. No application setting was changed for this.

Component tests exercised the real modal and design-system controls with mocked server actions. SQL tests exercised the real closure, triggers and reissue wrapper against fixture clients. The full signed-in production flow has not been run; it needs the approved migration and deployment. No real customer was ended for testing.

## Approved production rollout, 4 October 2026

Owner approved the exact packet with `1yes`. Applied to `tfcasgxopxegwrabvwat` through Supabase MCP. Local filename `20261004105351_oj_recurring_charge_end_date.sql` maps to production version `20261004111703`, name `oj_recurring_charge_end_date`. Approved checksum unchanged.

Production rollback smoke passed under authenticated and service_role: preview, stale confirmation refusal, confirmed final snapshot, immutable ending, rejected post-end instance, billing trigger, and actual final invoice reissue at £48.39 ex VAT plus £9.68 VAT. All dedicated smoke records rolled back. No real charge ended. Post-apply anon surface: all nine checks passed. Live generated types obtained for schema comparison.
