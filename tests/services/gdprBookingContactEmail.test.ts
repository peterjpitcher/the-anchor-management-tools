import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Table and event bookings keep the email a guest typed for them when the customer record holds a
 * different one (BK-078). That is personal data in a new place, so erasure has to find bookings by
 * it and clear it. Read from the source because the erasure runs against a dozen tables; the
 * pattern follows the other source checks in tests/services.
 */
const source = readFileSync(join(process.cwd(), 'src/services/gdpr.ts'), 'utf8')

function scrubBlock(table: string): string {
  const start = source.indexOf(`'${table}', {`, source.indexOf('await scrub('))
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('}, ', start))
}

describe('GDPR erasure covers the booking contact email', () => {
  it.each(['bookings', 'table_bookings'])('finds %s by contact_email as well as by customer', (table) => {
    expect(source).toMatch(new RegExp(`fetchRowsByIdentity\\(adminClient, '${table}', identity, \\{[^}]*emailColumns: \\['contact_email'\\]`))
  })

  it.each(['bookings', 'table_bookings'])('clears contact_email on %s', (table) => {
    expect(scrubBlock(table)).toContain('contact_email: null')
  })
})
