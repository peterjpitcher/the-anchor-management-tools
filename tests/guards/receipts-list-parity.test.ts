import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PNL_METRICS } from '@/lib/pnl/constants'
import { RECEIPT_CLASSIFICATION_SOURCES } from '@/lib/receipts/field-protection'
import { receiptExpenseCategorySchema } from '@/lib/validation'

/**
 * The expense categories and the classification sources are each written down in more than one
 * place: the code list, the database CHECK constraints and, for categories, the P&L map. They
 * drifted before: a category the code offered and the database refused fails as a save error with
 * no explanation, and one missing from the P&L map is spent and never reported.
 *
 * The constraints are read from the migrations: the last definition of each wins, as it does in
 * the database.
 */

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')

const migrationSql = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n')

/** The quoted values in the last `ADD CONSTRAINT <name> ... ;` across every migration. */
function lastConstraintValues(sql: string, name: string): string[] {
  const marker = `ADD CONSTRAINT ${name}`
  const start = sql.lastIndexOf(marker)
  if (start < 0) return []
  const end = sql.indexOf(';', start)
  const body = sql.slice(start + marker.length, end)
  return [...body.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1].replace(/''/g, "'"))
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

describe('receipt expense categories are one list', () => {
  const code = receiptExpenseCategorySchema.options

  it('has no category twice', () => {
    expect(new Set(code).size).toBe(code.length)
  })

  it('matches what the database allows on a transaction', () => {
    expect(sorted(lastConstraintValues(migrationSql, 'receipt_transactions_expense_category_valid'))).toEqual(sorted(code))
  })

  it('matches what the database allows on a rule', () => {
    expect(sorted(lastConstraintValues(migrationSql, 'receipt_rules_expense_category_valid'))).toEqual(sorted(code))
  })

  it('gives every category exactly one line in the P&L', () => {
    const reported = PNL_METRICS.filter((metric) => metric.type === 'expense').map((metric) => metric.expenseCategory ?? '')
    expect(sorted(reported)).toEqual(sorted(code))
  })
})

describe('receipt classification sources are one list', () => {
  it('matches what the database allows for a vendor', () => {
    expect(sorted(lastConstraintValues(migrationSql, 'receipt_transactions_vendor_source_check'))).toEqual(
      sorted(RECEIPT_CLASSIFICATION_SOURCES)
    )
  })

  it('matches what the database allows for a category', () => {
    expect(sorted(lastConstraintValues(migrationSql, 'receipt_transactions_expense_category_source_check'))).toEqual(
      sorted(RECEIPT_CLASSIFICATION_SOURCES)
    )
  })
})

describe('the constraint reader', () => {
  it('takes the last definition and reads quoted values', () => {
    const sql = `
      ALTER TABLE t ADD CONSTRAINT c CHECK (v IN ('old'));
      ALTER TABLE t DROP CONSTRAINT c;
      ALTER TABLE t ADD CONSTRAINT c CHECK (v = ANY (ARRAY['a'::text, 'b/c'::text, 'it''s'::text]));
      ALTER TABLE t ADD CONSTRAINT other CHECK (v IN ('x'));
    `
    expect(lastConstraintValues(sql, 'c')).toEqual(['a', 'b/c', "it's"])
    expect(lastConstraintValues(sql, 'missing')).toEqual([])
  })
})
