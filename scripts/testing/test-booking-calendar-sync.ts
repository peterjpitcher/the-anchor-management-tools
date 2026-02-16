#!/usr/bin/env tsx
/**
 * Google Calendar sync diagnostics (read-only).
 *
 * Safety note:
 * - This legacy script previously performed calendar writes + DB updates (unsafe).
 * - It is now strictly read-only and blocks `--confirm`.
 * - Use `scripts/testing/test-calendar-sync.ts` for diagnostics.
 * - Use `scripts/tools/resync-private-bookings-calendar.ts` for operational resync (multi-gated + capped).
 */

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error(
      'This script is read-only and does not support --confirm. Use scripts/tools/resync-private-bookings-calendar.ts for resync operations.'
    )
  }

  console.log('Calendar sync script (read-only)\n')
  console.log('This script is deprecated.')
  console.log('Use:')
  console.log('- scripts/testing/test-calendar-sync.ts (read-only diagnostics)')
  console.log('- scripts/tools/resync-private-bookings-calendar.ts (dangerous resync; multi-gated + capped)')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
