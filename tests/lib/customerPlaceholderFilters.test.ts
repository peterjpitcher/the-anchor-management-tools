import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Made-up walk-in and anonymised customers are kept out of the places staff count and search
 * customers (BK-082). They were 313 of 1,288 customers and over 40% of "new customers" in 90
 * days. Read from the source: each of these is a query chain against customers that must carry the
 * is_placeholder filter, and a mocked client would answer any filter.
 */
function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function customerQueries(text: string): string[] {
  const chains: string[] = []
  for (const match of text.matchAll(/\.from\('customers'\)/g)) {
    chains.push(text.slice(match.index!, match.index! + 400))
  }
  return chains
}

describe('placeholder customers are filtered out', () => {
  it.each([
    ['the customer list and its counts', 'src/app/actions/customers.ts', 4],
    ['the front-of-house customer search', 'src/app/api/foh/customers/search/route.ts', 1],
    ['the dashboard customer tiles', 'src/app/(authenticated)/dashboard/dashboard-data.ts', 4],
    ['the insights new-customer figures', 'src/lib/insights/sections/customers.ts', 2],
  ])('%s', (_label, file, expected) => {
    const filtered = customerQueries(source(file)).filter((chain) => chain.includes(".eq('is_placeholder', false)"))
    expect(filtered.length).toBeGreaterThanOrEqual(expected)
  })

  it('the customer insights treat placeholders as excluded records', () => {
    expect(source('src/lib/analytics/customer-insights.ts')).toContain("'is_placeholder.eq.true'")
  })

  it('anonymising a deleted customer marks it a placeholder', () => {
    expect(source('src/services/customers.ts')).toContain('is_placeholder: true')
  })
})
