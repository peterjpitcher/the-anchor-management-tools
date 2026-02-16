import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/* audit log scripts', () => {
  it('are strictly read-only and contain no DB mutation attempts', () => {
    const scriptPaths = [
      'scripts/testing/test-audit-log.ts',
      'scripts/testing/test-audit-log-rls.ts',
    ]

    for (const relativePath of scriptPaths) {
      const scriptPath = path.resolve(process.cwd(), relativePath)
      const script = fs.readFileSync(scriptPath, 'utf8')

      expect(script).toContain('read-only')
      expect(script).not.toContain("@/lib/supabase/server")
      expect(script).toContain("from '@/lib/supabase/admin'")
      expect(script).toContain('withEqualsPrefix')
      expect(script).toContain('/^[1-9]\\d*$/')
      expect(script).toContain('Invalid positive integer for --limit')
      expect(script).toContain('Number.isInteger')
      expect(script).toContain('--limit exceeds hard cap')
      expect(script).not.toContain('Number(value)')

      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')
      expect(script).not.toContain('CREATE OR REPLACE FUNCTION')

      // Prefer non-terminating exit codes so scripts are testable and fail-closed.
      expect(script).not.toContain('process.exit(')
      expect(script).toContain('process.exitCode')
    }
  })
})
