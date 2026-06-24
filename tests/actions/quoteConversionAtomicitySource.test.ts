import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const actionSource = readFileSync(resolve(process.cwd(), 'src/app/actions/quotes.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000022_quote_to_invoice_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000022_quote_to_invoice_atomicity.sql'),
  'utf8'
)

function functionBody(name: string) {
  const start = actionSource.indexOf(`export async function ${name}`)
  const next = actionSource.indexOf('\nexport async function ', start + 1)
  return actionSource.slice(start, next === -1 ? undefined : next)
}

describe('quote conversion atomicity wiring', () => {
  it('routes quote-to-invoice conversion through one RPC', () => {
    const body = functionBody('convertQuoteToInvoice')

    expect(body).toContain("rpc('convert_quote_to_invoice_atomic'")
    expect(body).not.toContain("from('invoice_line_items')")
    expect(body).not.toContain('rollbackCreatedInvoice')
    expect(body).not.toContain("rpc('get_and_increment_invoice_series'")
  })

  it('ships migration and rollback SQL', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice_atomic')
    expect(migrationSource).toContain('FOR UPDATE')
    expect(migrationSource).toContain("jsonb_build_object(\n    'invoice'")
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.convert_quote_to_invoice_atomic')
  })
})
