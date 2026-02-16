import fs from 'node:fs'
import path from 'node:path'

describe('scripts/tools/resync-private-bookings-calendar.ts', () => {
  it('defaults to dry-run and requires explicit multi-gating + caps for mutations', () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'scripts/tools/resync-private-bookings-calendar.ts'
    )
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('Dry run mode')
    expect(script).toContain('--confirm')
    expect(script).toContain('RUN_CALENDAR_RESYNC_MUTATION')
    expect(script).toContain('ALLOW_CALENDAR_RESYNC_MUTATION')
    expect(script).toContain('--limit')
    expect(script).toContain('--booking-id')

    // Scripts should not import Next.js server Supabase client helpers.
    expect(script).toContain("from '@/lib/supabase/admin'")
    expect(script).not.toContain('supabase/server')
    expect(script).not.toContain('next/headers')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})
