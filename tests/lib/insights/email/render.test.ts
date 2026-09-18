import { describe, expect, it } from 'vitest'
import { renderInsightsEmail } from '@/lib/insights/email/render'
import { EMAIL_BUDGET } from '@/lib/insights/thresholds'
import { buildFixtureReport, FIXTURE_APP_URL } from '../helpers/report-fixture'

const PAGE_ONLY_NAMES = ['Chris Example', 'Jordan Example', 'Alex Example', 'Amanda Example', 'Pat Example', 'Jane Doe']

function render(options: Parameters<typeof buildFixtureReport>[0] = {}) {
  return renderInsightsEmail(buildFixtureReport(options), { appUrl: FIXTURE_APP_URL })
}

describe('renderInsightsEmail', () => {
  it('uses real lists and never a pre-formatted paragraph', () => {
    const { html } = render()
    expect(html).toContain('<ul')
    expect(html).toContain('<ol')
    expect(html).toContain('<li')
    expect(html).not.toContain('pre-line')
  })

  it('has no background colour anywhere, so it prints cleanly', () => {
    const { html } = render({ heavy: true, notChecked: ['parking'] })
    expect(html).not.toMatch(/background/i)
    expect(html).not.toMatch(/bgcolor/i)
  })

  it('shows every section with its status word and headline, in report order', () => {
    const report = buildFixtureReport()
    const { html, text } = renderInsightsEmail(report, { appUrl: FIXTURE_APP_URL })
    let lastIndex = -1
    for (const section of report.sections) {
      const index = html.indexOf(`: ${section.title}</h2>`)
      expect(index).toBeGreaterThan(lastIndex)
      lastIndex = index
      expect(html).toContain(section.headline.replace(/'/g, '&#39;'))
      expect(text).toContain(section.title.toUpperCase())
    }
    expect(html).toContain('🔴 Action: Hosted events')
    expect(html).toContain('🟢 OK: Parking')
    expect(html.indexOf('Manager actions this week')).toBeGreaterThan(html.indexOf(': Recruitment</h2>'))
  })

  it('keeps names that are not the reader\'s to act on out of the email and text', () => {
    const { html, text } = render({ heavy: true })
    for (const name of PAGE_ONLY_NAMES) {
      expect(html).not.toContain(name)
      expect(text).not.toContain(name)
    }
    // The leave requester is the person to act on, so their name may appear.
    expect(html).toContain('Sam Example')
    // A red with page-only text still reaches the email through its action text.
    expect(html).toContain('Review repeated missed checks with the staff involved')
  })

  it('never prints undefined, NaN or Invalid Date', () => {
    const { html, text } = render({ heavy: true, notChecked: ['events', 'invoices'] })
    for (const bad of ['undefined', 'NaN', 'Invalid Date']) {
      expect(html).not.toContain(bad)
      expect(text).not.toContain(bad)
    }
  })

  it('links only to absolute URLs on the app origin', () => {
    const report = buildFixtureReport()
    report.sections[0].signals[0] = { ...report.sections[0].signals[0], action: { ...report.sections[0].signals[0].action!, href: 'https://evil.example/phish' } }
    const { html } = renderInsightsEmail(report, { appUrl: FIXTURE_APP_URL })
    expect(html).not.toContain('evil.example')
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    expect(hrefs.length).toBeGreaterThan(10)
    expect(hrefs.every((href) => href.startsWith(`${FIXTURE_APP_URL}/`))).toBe(true)
  })

  it('escapes report text', () => {
    const report = buildFixtureReport()
    report.sections[1].headline = '<script>alert(1)</script> & more'
    const { html } = renderInsightsEmail(report, { appUrl: FIXTURE_APP_URL })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more')
  })

  it('keeps a heavy week within the row and size budgets, and says what is hidden', () => {
    const { html, rowsShown } = render({ heavy: true })
    expect(rowsShown).toBeLessThanOrEqual(EMAIL_BUDGET.exceptionRows)
    expect(new TextEncoder().encode(html).byteLength).toBeLessThan(EMAIL_BUDGET.maxBytes)
    expect(html).toContain('more on the Insights page')
  })

  it('never hides a red silently when the budget runs out', () => {
    const report = buildFixtureReport({ heavy: true })
    const { html } = renderInsightsEmail(report, { appUrl: FIXTURE_APP_URL })
    // Maintenance has six criticals in the heavy fixture; some must be summarised, not dropped.
    const reds = report.sections.flatMap((section) => section.signals.filter((signal) => signal.kind === 'issue' && signal.rag === 'red'))
    const shownReds = (html.match(/🔴 [^<]*<a/g) ?? []).length
    if (shownReds < reds.length) expect(html).toMatch(/including \d+ to action/)
  })

  it('lists not-checked sections in the summary and labels them', () => {
    const { html, subject } = render({ notChecked: ['cashing_up'] })
    expect(html).toContain('⚪ Not checked: Cashing up')
    expect(html).toContain('Not checked: Cashing up.')
    expect(subject).toContain('1 not checked')
  })

  it('numbers the manager actions, shows merged members, and ends with the shredding note', () => {
    const { html, text, subject } = render()
    expect(subject).toMatch(/^The Anchor weekly report, Fri 25 Sep: \d+ action, \d+ watch$/)
    expect(text).toMatch(/\n1\. 🔴 Action: /)
    expect(text).toContain('   - Mon 28 Sep, bar, 18:00 to 23:00')
    expect(html).toContain('<li style="margin:0 0 3px">Mon 28 Sep, bar, 18:00 to 23:00</li>')
    expect(html).toContain('Shred after the meeting.')
    expect(text).toContain('- Biggest win: ')
  })
})
