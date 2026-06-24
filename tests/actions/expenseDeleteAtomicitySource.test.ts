import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const actionSource = readFileSync(resolve(process.cwd(), 'src/app/actions/expenses.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000026_expense_delete_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000026_expense_delete_atomicity.sql'),
  'utf8'
)

function functionBody(name: string) {
  const start = actionSource.indexOf(`export async function ${name}`)
  const next = actionSource.indexOf('\nexport async function ', start + 1)
  return actionSource.slice(start, next === -1 ? undefined : next)
}

describe('expense delete atomicity wiring', () => {
  it('uses a single RPC for expense and file-row deletion', () => {
    const body = functionBody('deleteExpense')

    expect(body).toContain("rpc('delete_expense_atomic'")
    expect(body).not.toContain("from('expense_files')")
    expect(body).not.toContain("from('expenses').delete")
  })

  it('ships migration and rollback SQL', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.delete_expense_atomic')
    expect(migrationSource).toContain('FOR UPDATE')
    expect(migrationSource).toContain('array_agg(storage_path')
    expect(migrationSource).toContain('DELETE FROM public.expenses')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.delete_expense_atomic')
  })
})
