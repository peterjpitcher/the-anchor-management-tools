import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InsightsReportView } from '@/app/(authenticated)/insights/_components/InsightsReportView'
import { buildFixtureReport } from '../../lib/insights/helpers/report-fixture'

const mocks = vi.hoisted(() => ({
  canView: vi.fn(),
  build: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }),
  admin: vi.fn(),
}))
vi.mock('@/lib/insights/access', () => ({ currentUserCanViewInsights: mocks.canView }))
vi.mock('@/lib/insights/registry', () => ({ buildWeeklyInsights: mocks.build }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  mocks.canView.mockReset()
  mocks.build.mockReset()
  mocks.admin.mockReset()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.example.test')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

async function loadPage() {
  return (await import('@/app/(authenticated)/insights/page')).default
}

describe('Insights page access', () => {
  it('redirects anyone who is not a super admin before any report code runs', async () => {
    mocks.canView.mockResolvedValue(false)
    const InsightsPage = await loadPage()
    await expect(InsightsPage()).rejects.toThrow('REDIRECT:/unauthorized')
    expect(mocks.build).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('builds the live report for a super admin with a signalled client per section', async () => {
    mocks.canView.mockResolvedValue(true)
    mocks.build.mockResolvedValue(buildFixtureReport())
    const InsightsPage = await loadPage()
    const element = await InsightsPage()
    expect(mocks.build).toHaveBeenCalledTimes(1)
    const options = mocks.build.mock.calls[0][0]
    expect(options.appUrl).toBe('https://management.example.test')
    const signal = new AbortController().signal
    options.createDb(signal)
    expect(mocks.admin).toHaveBeenCalledWith({ signal })
    expect(renderToStaticMarkup(element)).toContain('Manager actions this week')
  })

  it('shows an error, not an empty report, when the build fails', async () => {
    mocks.canView.mockResolvedValue(true)
    mocks.build.mockRejectedValue(new Error('boom'))
    const InsightsPage = await loadPage()
    const html = renderToStaticMarkup(await InsightsPage())
    expect(html).toContain('Insights are unavailable')
    expect(html).not.toContain('Manager actions this week')
  })
})

describe('InsightsReportView', () => {
  const report = buildFixtureReport({ notChecked: ['parking'] })
  report.sections[7].lists[0].items = Array.from({ length: 14 }, (_, i) => ({ text: `Job ${i + 1}`, href: `https://management.example.test/maintenance/m${i}` }))
  const html = renderToStaticMarkup(<InsightsReportView report={report} />)

  it('gives every section a heading, a status word and an anchor the jump links use', () => {
    for (const section of report.sections) {
      expect(html).toContain(`id="${section.key}"`)
      expect(html).toContain(`href="#${section.key}"`)
      expect(html).toContain(`: ${section.title}</span></h2>`)
    }
    expect(html).toContain('Not checked')
    expect(html).toContain('id="actions"')
  })

  it('keeps links on this host rather than the configured origin', () => {
    expect(html).toContain('href="/private-bookings/p1"')
    expect(html).not.toContain('href="https://management.example.test')
  })

  it('shows the first ten items of a long list, the rest behind Show all, and prints them all', () => {
    expect(html).toContain('Show all 14')
    expect(html).toContain('<details')
    expect((html.match(/Job 14/g) ?? []).length).toBe(2)
    expect(html).toContain('hidden print:list-item')
  })

  it('numbers the manager actions', () => {
    expect(html).toMatch(/<ol[^>]*list-decimal/)
  })
})
