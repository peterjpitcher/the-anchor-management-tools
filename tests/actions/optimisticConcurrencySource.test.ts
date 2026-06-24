import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000027_optimistic_concurrency_guards.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000027_optimistic_concurrency_guards.sql'),
  'utf8'
)
const leaveSource = readFileSync(resolve(process.cwd(), 'src/app/actions/leave.ts'), 'utf8')
const timeclockSource = readFileSync(resolve(process.cwd(), 'src/app/actions/timeclock.ts'), 'utf8')
const rotaSource = readFileSync(resolve(process.cwd(), 'src/app/actions/rota.ts'), 'utf8')
const invoicesSource = readFileSync(resolve(process.cwd(), 'src/app/actions/invoices.ts'), 'utf8')
const bohStatusRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/boh/table-bookings/[id]/status/route.ts'),
  'utf8'
)
const fohCancelRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/foh/bookings/[id]/cancel/route.ts'),
  'utf8'
)
const fohNoShowRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/foh/bookings/[id]/no-show/route.ts'),
  'utf8'
)

function functionBody(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe('A-061 optimistic concurrency wiring', () => {
  it('guards leave review with expected pending status', () => {
    const body = functionBody(leaveSource, 'reviewLeaveRequest')

    expect(body).toContain(".eq('status', 'pending')")
    expect(body).toContain("return { success: false, error: 'Request was already reviewed' }")
  })

  it('guards table booking status writes with the previously loaded status', () => {
    for (const source of [bohStatusRoute, fohCancelRoute, fohNoShowRoute]) {
      expect(source).toContain(".eq('status', booking.status)")
      expect(source).toContain('Booking changed before this update could be applied')
    }
  })

  it('enforces open timeclock and couldnt-work uniqueness in SQL and actions', () => {
    expect(migrationSource).toContain('uniq_timeclock_sessions_open_employee')
    expect(migrationSource).toContain('WHERE clock_out_at IS NULL')
    expect(migrationSource).toContain('uniq_rota_couldnt_work_marker')
    expect(migrationSource).toContain("status = 'sick'")
    expect(timeclockSource).toContain("error.code === '23505'")
    expect(rotaSource).toContain('isUniqueConstraintViolation(error)')
  })

  it('creates credit notes through a locked RPC', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.create_credit_note_atomic')
    expect(migrationSource).toContain('pg_advisory_xact_lock')
    expect(migrationSource).toContain('FOR UPDATE')
    expect(invoicesSource).toContain("rpc('create_credit_note_atomic'")
    expect(invoicesSource).not.toContain("from('credit_notes')\n      .select('credit_note_number')")
  })

  it('ships rollback SQL for DB changes', () => {
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.create_credit_note_atomic')
    expect(rollbackSource).toContain('DROP INDEX IF EXISTS public.uniq_rota_couldnt_work_marker')
    expect(rollbackSource).toContain('DROP INDEX IF EXISTS public.uniq_timeclock_sessions_open_employee')
  })
})
