// The Finance tab row: Export shows only to somebody with the invoices export permission (the
// Export page sends everyone else to /unauthorized), and all six pages build the row the same way.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FINANCE_NAV, financeNav } from '@/app/(authenticated)/invoices/_shared/nav'

const quoteActions = vi.hoisted(() => ({
  getQuotes: vi.fn().mockResolvedValue({ quotes: [] }),
  getQuoteSummary: vi.fn().mockResolvedValue({
    summary: { total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/quotes',
}))

// Everything except export.
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: (_module: string, action: string) => action !== 'export', loading: false }),
}))

vi.mock('@/app/actions/quotes', () => quoteActions)

import QuotesClient from '@/app/(authenticated)/quotes/_components/QuotesClient'

const SIX_PAGES = [
  'src/app/(authenticated)/invoices/_components/InvoicesClient.tsx',
  'src/app/(authenticated)/quotes/_components/QuotesClient.tsx',
  'src/app/(authenticated)/invoices/recurring/page.tsx',
  'src/app/(authenticated)/invoices/catalog/page.tsx',
  'src/app/(authenticated)/invoices/vendors/page.tsx',
  'src/app/(authenticated)/invoices/export/page.tsx',
]

describe('financeNav', () => {
  it('shows all six tabs to somebody who can export', () => {
    expect(financeNav({ canExport: true }).map((item) => item.label)).toEqual([
      'Invoices',
      'Quotes',
      'Recurring',
      'Catalog',
      'Vendors',
      'Export',
    ])
  })

  it('hides only the Export tab from somebody who cannot export', () => {
    const labels = financeNav({ canExport: false }).map((item) => item.label)

    expect(labels).toEqual(['Invoices', 'Quotes', 'Recurring', 'Catalog', 'Vendors'])
    expect(FINANCE_NAV).toHaveLength(6)
  })

  it.each(SIX_PAGES)('%s builds its tabs with financeNav, never the unfiltered constant', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')

    expect(source).toMatch(/navItems[=:]\s*\{?financeNav\(\{ canExport/)
    expect(source).not.toMatch(/navItems[=:]\s*\{?FINANCE_NAV\b/)
  })

  it('leaves Export out of the Quotes tab row for somebody without the export permission', async () => {
    render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={{ total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 }}
        initialStatus="all"
        initialError={null}
        permissions={{ canCreate: true, canEdit: true, canDelete: true, canExport: false }}
      />,
    )

    expect((await screen.findAllByRole('tab', { name: 'Vendors' })).length).toBeGreaterThan(0)
    expect(screen.queryByRole('tab', { name: 'Export' })).not.toBeInTheDocument()
  })
})
