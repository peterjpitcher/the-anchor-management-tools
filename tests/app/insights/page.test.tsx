import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InsightsReportView } from '@/app/(authenticated)/insights/_components/InsightsReportView'
import { INSIGHT_STATUS_WORD } from '@/app/(authenticated)/insights/_shared/status-ui'
import { insightSectionTitle } from '@/app/(authenticated)/insights/_shared/title'
import { buildFixtureReport } from '../../lib/insights/helpers/report-fixture'

const mocks = vi.hoisted(() => ({
  canView: vi.fn(),
  build: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }),
  admin: vi.fn(),
  cache: null as null | ReturnType<typeof import('../../lib/insights/helpers/fake-next-cache').createFakeNextCache>,
}))
vi.mock('next/cache', async () => {
  const { createFakeNextCache } = await import('../../lib/insights/helpers/fake-next-cache')
  mocks.cache = createFakeNextCache()
  return { unstable_cache: mocks.cache.unstable_cache, revalidateTag: mocks.cache.revalidateTag }
})
vi.mock('@/lib/insights/access', () => ({ currentUserCanViewInsights: mocks.canView }))
vi.mock('@/lib/insights/registry', () => ({ buildWeeklyInsights: mocks.build }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  mocks.canView.mockReset()
  mocks.build.mockReset()
  mocks.admin.mockReset()
  mocks.cache?.reset()
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
    expect(renderToStaticMarkup(element)).toContain('Manager Actions This Week')
  })

  it('serves the cached report to a second render and shows the London time it was worked out', async () => {
    mocks.canView.mockResolvedValue(true)
    // Pinned mid-slot so the two renders can never straddle a five-minute boundary.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T12:01:00Z'))
    // 05:00 UTC on 25 September 2026 is 06:00 in London (BST).
    mocks.build.mockResolvedValue(buildFixtureReport({ now: new Date('2026-09-25T05:00:00Z') }))
    const InsightsPage = await loadPage()
    const first = renderToStaticMarkup(await InsightsPage())
    const second = renderToStaticMarkup(await InsightsPage())
    expect(mocks.build).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(first).toContain('Figures worked out at 06:00')
    expect(first).toContain('Refresh now')
    // The access check still runs on every render, before the cache is read.
    expect(mocks.canView).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('shows an error, not an empty report, when the build fails', async () => {
    mocks.canView.mockResolvedValue(true)
    mocks.build.mockRejectedValue(new Error('boom'))
    const InsightsPage = await loadPage()
    const html = renderToStaticMarkup(await InsightsPage())
    expect(html).toContain('Insights are unavailable')
    expect(html).not.toContain('Manager Actions This Week')
  })
})

describe('insightSectionTitle', () => {
  it('shows a stored sentence-case section title in Title Case, small words lower case', () => {
    expect(insightSectionTitle('Hosted events')).toBe('Hosted Events')
    expect(insightSectionTitle('Employees and compliance')).toBe('Employees and Compliance')
    expect(insightSectionTitle('Rota, shifts and leave')).toBe('Rota, Shifts and Leave')
    expect(insightSectionTitle('Maintenance')).toBe('Maintenance')
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
      // The card title is the section's heading, in Title Case like every card title; the
      // section is named with its status word.
      const title = insightSectionTitle(section.title)
      expect(html).toMatch(new RegExp(`<h3[^>]*>${title}</h3>`))
      expect(html).toContain(`aria-label="${title}: ${INSIGHT_STATUS_WORD[section.status]}"`)
    }
    expect(html).toContain('Not checked')
    expect(html).toContain('id="actions"')
  })

  it('carries the Orange Jelly logo on paper only, loaded before Print is pressed', () => {
    const logos = html.match(/<img[^>]*alt="Orange Jelly"[^>]*>/g) ?? []
    expect(logos.length).toBeGreaterThan(0)
    for (const logo of logos) {
      // Hidden on screen, shown in print. Not lazy: a hidden lazy image may never be fetched.
      expect(logo).toMatch(/class="[^"]*\bhidden\b[^"]*print:block/)
      expect(logo).toContain('logo-horizontal.png')
      expect(logo).not.toContain('loading="lazy"')
    }
  })

  it('keeps the sub-list titles inside a card as headings, so screen readers can jump between them', () => {
    // SubHeading: h4 under the card title (h3), in Title Case like every other sub-heading.
    expect(html).toMatch(/<h4[^>]*>Needs Attention<\/h4>/)
    expect(html).toMatch(/<h4[^>]*>Going Well<\/h4>/)
    expect(html).toMatch(/<h4[^>]*>Next 14 Days<\/h4>/)
    // Only the display changes: the stored sentence-case titles stay as the report wrote them.
    expect(html).not.toMatch(/<h4[^>]*>Needs attention<\/h4>/)
  })

  it('shows a campaign list title exactly as written, never recased into Title Case', () => {
    const withCampaign = buildFixtureReport()
    withCampaign.sections[7].lists.push({
      title: 'Halloween party (customer email, first sent Thu 24 Sep, early figures)',
      titleAsWritten: true,
      items: [{ text: 'Delivered 90 of 100 sent so far.' }],
    })
    const markup = renderToStaticMarkup(<InsightsReportView report={withCampaign} />)

    expect(markup).toMatch(/<h4[^>]*>Halloween party \(customer email, first sent Thu 24 Sep, early figures\)<\/h4>/)
    expect(markup).not.toContain('Halloween Party')
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

  it('keeps a collapsed reference list closed on screen and off paper', () => {
    const withCollapsed = buildFixtureReport()
    withCollapsed.sections[7].lists.push({ title: 'All open jobs', collapsed: true, items: Array.from({ length: 12 }, (_, i) => ({ text: `Open job ${i + 1}` })) })
    const markup = renderToStaticMarkup(<InsightsReportView report={withCollapsed} />)
    const details = markup.slice(markup.indexOf('<details class="text-sm print:hidden">'))
    expect(details).toContain('All open jobs')
    expect(details).toContain('(show all 12)')
    // Every item appears once, inside the closed, non-printing details; no print-only copies.
    expect((markup.match(/Open job 12</g) ?? []).length).toBe(1)
    expect(details).toContain('Open job 12<')
  })

  it('numbers the manager actions', () => {
    expect(html).toMatch(/<ol[^>]*list-decimal/)
  })
})
