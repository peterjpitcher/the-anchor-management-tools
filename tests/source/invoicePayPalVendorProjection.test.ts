import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The reminder job's queries live in the job module; the cron route only authenticates and
// calls it.
const sources = [
  'src/lib/invoices/reminder-job.ts',
]

describe('automatic invoice vendor projections', () => {
  it.each(sources)('%s includes the vendor PayPal setting', (path) => {
    const source = readFileSync(path, 'utf8')
    const projection = source.match(/vendor:invoice_vendors\(\s*([\s\S]*?)\n\s*\)/)?.[1]

    expect(projection).toBeDefined()
    expect(projection).toMatch(/\bpaypal_payments_enabled\b/)
  })

  it.each(sources)('%s reads the vendor details the invoice PDF prints', (path) => {
    const source = readFileSync(path, 'utf8')
    const projection = source.match(/vendor:invoice_vendors\(\s*([\s\S]*?)\n\s*\)/)?.[1] ?? ''

    // A reminder attaches "another copy" of the invoice, so the copy must carry the same
    // client block as the original.
    for (const column of ['name', 'contact_name', 'email', 'phone', 'address', 'vat_number', 'payment_terms']) {
      expect(projection).toMatch(new RegExp(`\\b${column}\\b`))
    }
  })
})
