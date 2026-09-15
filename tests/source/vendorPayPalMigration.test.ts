import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = join(process.cwd(), 'supabase/migrations')
const matchingMigrations = readdirSync(migrationsDirectory).filter((fileName) =>
  fileName.endsWith('_vendor_paypal_payments_enabled.sql'),
)

describe('vendor PayPal setting migration', () => {
  it('fails closed and enables only the approved vendor', () => {
    expect(matchingMigrations).toHaveLength(1)

    const sql = readFileSync(join(migrationsDirectory, matchingMigrations[0]), 'utf8')

    expect(sql).toMatch(
      /paypal_payments_enabled\s+boolean\s+not null\s+default false/i,
    )
    expect(sql).toContain('ed3bb6b9-01a5-4894-b54f-b83fe73cc52b')
    expect(sql).toContain('Sidemen Entertainment Limited')
    expect(sql).toMatch(
      /update\s+public\.invoice_vendors\s+set\s+paypal_payments_enabled\s*=\s*true,\s*updated_at\s*=\s*now\(\)\s+where\s+id\s*=\s*'ed3bb6b9-01a5-4894-b54f-b83fe73cc52b'::uuid\s+and\s+name\s*=\s*'Sidemen Entertainment Limited'\s*;/i,
    )
    expect(sql).not.toMatch(/default true/i)
    expect(sql).not.toMatch(/\b(drop|delete|truncate|grant|revoke)\b/i)
  })
})
