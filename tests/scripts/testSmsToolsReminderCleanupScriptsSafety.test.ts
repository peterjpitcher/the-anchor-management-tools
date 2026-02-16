import fs from 'node:fs'
import path from 'node:path'

type ReminderCleanupScriptEntry = {
  path: string
  runEnv: string
  allowEnv: string
  capMarkers: string[]
}

function readScript(relativePath: string): string {
  const scriptPath = path.resolve(process.cwd(), relativePath)
  return fs.readFileSync(scriptPath, 'utf8')
}

describe('scripts/sms-tools reminder cleanup scripts', () => {
  const scripts: ReminderCleanupScriptEntry[] = [
    {
      path: 'scripts/sms-tools/clear-stuck-jobs.ts',
      runEnv: 'RUN_CLEAR_STUCK_JOBS_MUTATION',
      allowEnv: 'ALLOW_CLEAR_STUCK_JOBS_MUTATION',
      capMarkers: ['--stale-limit', '--pending-limit']
    },
    {
      path: 'scripts/sms-tools/clear-reminder-backlog.ts',
      runEnv: 'RUN_CLEAR_REMINDER_BACKLOG_MUTATION',
      allowEnv: 'ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION',
      capMarkers: ['--reminder-limit', '--job-limit']
    },
    {
      path: 'scripts/sms-tools/fix-past-reminders.ts',
      runEnv: 'RUN_FIX_PAST_REMINDERS_MUTATION',
      allowEnv: 'ALLOW_FIX_PAST_REMINDERS_MUTATION',
      capMarkers: ['--reminder-limit', '--job-limit']
    },
    {
      path: 'scripts/sms-tools/finalize-event-reminders.ts',
      runEnv: 'RUN_FINALIZE_EVENT_REMINDERS_MUTATION',
      allowEnv: 'ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION',
      capMarkers: ['--reminder-limit', '--job-limit']
    }
  ]

  it('default to dry-run/read-only and require explicit mutation gating with caps', () => {
    for (const entry of scripts) {
      const script = readScript(entry.path)

      expect(script).toContain('--confirm')
      expect(script).toContain('DRY-RUN')
      expect(script).toContain(entry.runEnv)
      expect(script).toContain(entry.allowEnv)
      for (const capMarker of entry.capMarkers) {
        expect(script).toContain(capMarker)
      }

      expect(script).toContain('process.exitCode = 1')
      expect(script).not.toContain('process.exit(')
    }
  })

  it('use admin client + query safety wrappers and avoid raw supabase client imports', () => {
    for (const entry of scripts) {
      const script = readScript(entry.path)

      expect(script).toContain('createAdminClient')
      expect(script).toContain('assertScriptQuerySucceeded')
      expect(script).not.toContain("@supabase/supabase-js")
    }
  })
})

