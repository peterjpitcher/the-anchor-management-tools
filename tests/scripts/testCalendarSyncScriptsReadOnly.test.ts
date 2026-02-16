import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/* calendar sync scripts', () => {
  it('are strictly read-only and contain no calendar/DB mutation attempts', () => {
    const scriptPaths = [
      'scripts/testing/test-calendar-sync.ts',
      'scripts/testing/test-calendar-sync-admin.ts',
      'scripts/testing/test-calendar-final.ts',
      'scripts/testing/test-booking-calendar-sync.ts',
      'scripts/testing/test-birthday-calendar-sync.ts',
    ]

    for (const relativePath of scriptPaths) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('read-only')
      expect(script).not.toContain("@/lib/supabase/server")

      // Must not mutate production data.
      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')

      // Must not perform external calendar writes from diagnostic scripts.
      expect(script).not.toContain('syncCalendarEvent')
      expect(script).not.toContain('syncBirthdayCalendarEvent')

      // Prefer non-terminating exit codes so scripts are testable and fail-closed.
      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')

      // Safety guard should be explicit and testable.
      expect(script).toContain('--confirm')
      expect(script).toContain('does not support --confirm')

      if (relativePath === 'scripts/testing/test-calendar-sync.ts') {
        expect(script).toContain('withEqualsPrefix')
        expect(script).toContain('/^[1-9]\\d*$/')
        expect(script).toContain('Invalid positive integer for --limit')
        expect(script).toContain('Number.isInteger')
        expect(script).toContain('--limit exceeds hard cap')
        expect(script).not.toContain('Number(value)')
      }

      if (script.includes('createAdminClient')) {
        expect(script).toContain("from '@/lib/supabase/admin'")
      }
    }
  })
})
