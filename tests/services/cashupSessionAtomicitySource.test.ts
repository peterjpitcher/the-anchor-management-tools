import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/cashing-up.service.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000025_cashup_session_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000025_cashup_session_atomicity.sql'),
  'utf8'
)

function methodBody(name: string) {
  const start = serviceSource.indexOf(`static async ${name}`)
  const next = serviceSource.indexOf('\n  static async ', start + 1)
  return serviceSource.slice(start, next === -1 ? undefined : next)
}

describe('cash-up session atomicity wiring', () => {
  it('routes session and child-row saves through one RPC', () => {
    const body = methodBody('upsertSession')

    expect(body).toContain("rpc('upsert_cashup_session_atomic'")
    expect(body).not.toContain("from('cashup_payment_breakdowns')")
    expect(body).not.toContain("from('cashup_cash_counts')")
    expect(body).not.toContain("from('cashup_sales_breakdowns')")
    expect(body).not.toContain('restoreOrRollbackChildren')
  })

  it('ships migration and rollback SQL', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.upsert_cashup_session_atomic')
    expect(migrationSource).toContain('FOR UPDATE')
    expect(migrationSource).toContain('DELETE FROM public.cashup_payment_breakdowns')
    expect(migrationSource).toContain('INSERT INTO public.cashup_payment_breakdowns')
    expect(migrationSource).toContain('INSERT INTO public.cashup_cash_counts')
    expect(migrationSource).toContain('INSERT INTO public.cashup_sales_breakdowns')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.upsert_cashup_session_atomic')
  })
})
