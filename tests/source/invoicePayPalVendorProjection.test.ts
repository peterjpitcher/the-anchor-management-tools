import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routes = [
  'src/app/api/cron/auto-send-invoices/route.ts',
  'src/app/api/cron/invoice-reminders/route.ts',
]

describe('automatic invoice vendor projections', () => {
  it.each(routes)('%s includes the vendor PayPal setting', (route) => {
    const source = readFileSync(route, 'utf8')
    const projection = source.match(/vendor:invoice_vendors\(\s*([\s\S]*?)\n\s*\)/)?.[1]

    expect(projection).toBeDefined()
    expect(projection).toMatch(/\bpaypal_payments_enabled\b/)
  })
})
