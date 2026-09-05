import { describe, expect, it } from 'vitest'
import { renderManagerReport } from './render'
import { MANAGER_REPORT_SECTIONS } from './types'
import type { ManagerReportEntry, ManagerReportRenderInput } from './types'

const input: ManagerReportRenderInput = {
  entries: [],
  periodStart: '2026-10-23T08:00:00.000Z',
  periodEnd: '2026-10-30T09:00:00.000Z',
  appUrl: 'https://management.example.test',
}

function entry(overrides: Partial<ManagerReportEntry> = {}): ManagerReportEntry {
  return {
    id: 'synthetic-1', key: 'synthetic-1', to: 'manager@example.test',
    section: 'table_bookings', subject: 'New table booking: TEST-123',
    createdAt: '2026-10-26T08:15:00.000Z',
    html: '<p>A new table booking has been created.</p><ul><li><strong>Reference:</strong> TEST-123</li><li><strong>When:</strong> Saturday 31 October 2026 at 18:30</li><li><strong>Party size:</strong> 6</li><li><strong>Guest:</strong> Alex Example</li><li><strong>Status:</strong> Confirmed</li></ul>',
    ...overrides,
  }
}

describe('renderManagerReport', () => {
  it('retains the original reminder date when a failed collection is queued later', () => {
    const report = renderManagerReport({ ...input, entries: [entry({
      section: 'staff_shift_reminders', createdAt: '2026-10-29T10:00:00Z',
      metadata: { source_recorded_at: '2026-10-26T08:15:00Z' },
    })] })
    expect(report.text).toContain('Recorded: 26 Oct 2026, 08:15 (London)')
    expect(report.text).not.toContain('Recorded: 29 Oct 2026')
  })

  it('renders all eight categories with truthful counts, detail, snapshot dates and management links', () => {
    const entries = MANAGER_REPORT_SECTIONS.map((section, index) => entry({
      id: `synthetic-${index}`, key: `synthetic-${index}`, section,
      ...(section === 'table_bookings' ? {} : {
        subject: `${section} synthetic update`,
        text: `${section}: 0 outstanding items.`,
      }),
    }))
    const report = renderManagerReport({ ...input, entries })
    expect(report.text).toContain('8 queued updates')
    for (const title of ['New table bookings', 'Staff shift reminders', 'Holiday approval reminders', 'Checklist alerts', 'Checklist summary', 'Recruitment', 'Private-booking summary', 'Rota summary']) {
      expect(report.text).toContain(title)
    }
    expect(report.text).toContain('Saturday 31 October 2026 at 18:30')
    expect(report.text).toContain('Party size: 6')
    expect(report.text).toContain('Guest: Alex Example')
    expect(report.text).toContain('Snapshot: 26 Oct 2026, 08:15 (London)')
    expect(report.html).toContain('href="https://management.example.test/rota/leave"')
    expect(report.text).toContain('0 outstanding items')
    expect(`${report.html}${report.text}`).not.toMatch(/undefined|NaN|Invalid Date/)
  })

  it('shows an empty weekly report without claiming the business has no problems', () => {
    const report = renderManagerReport(input)
    expect(report.text).toContain('0 queued updates')
    expect(report.text.match(/No queued updates in this period\./g)).toHaveLength(5)
    expect(report.text.match(/No snapshot available for this report/g)).toHaveLength(3)
    expect(report.attachment).toBeUndefined()
    expect(report.text).toContain('check the management app for the current position')
  })

  it('escapes names, source markup, decoded entities and malicious links in body and attachment', () => {
    const report = renderManagerReport({ ...input, entries: [entry({
      subject: '<img src=x onerror=alert(1)> & "Name"',
      html: '<style>body{display:none}</style><script>alert("bad")</script><ul><li><strong>Guest:</strong> &lt;svg onload=alert(1)&gt; &amp; &#x1f642;</li><li><strong>When:</strong> Friday 30 October at 19:00</li><li><strong>Party size:</strong> 6</li><li><strong>Notes:</strong> <a href="javascript:alert(1)">Dietary note</a></li><li><strong>Extra:</strong> ' + 'Full details. '.repeat(100) + '</li></ul>',
    })] })
    for (const output of [report.html, report.attachment!.content]) {
      expect(output).not.toMatch(/<script|<style|<img|<svg|javascript:|display:none/)
      expect(output).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(output).toContain('&lt;svg onload=alert(1)&gt; &amp; 🙂')
      const document = new DOMParser().parseFromString(output, 'text/html')
      expect(document.querySelectorAll('script,img,svg,iframe,object,style')).toHaveLength(0)
      for (const link of document.querySelectorAll('a')) {
        expect(link.getAttribute('href')).toMatch(/^https:\/\/management\.example\.test\//)
      }
    }
  })

  it('retains every item in full details when a busy week exceeds the visible limit', () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry({
      id: `item-${index}`, key: `item-${index}`, section: 'recruitment',
      subject: `Applicant example ${index}`, text: `Full detail marker ${index}.`,
      createdAt: `2026-10-${String(20 + Math.floor(index / 4)).padStart(2, '0')}T0${index % 4}:00:00Z`,
    }))
    const report = renderManagerReport({ ...input, entries })
    expect(report.text).toContain('Recruitment (40 updates)')
    expect(report.text).toContain('28 more updates are included in the attached full report.')
    expect(report.html.match(/<article /g)).toHaveLength(12)
    expect(report.attachment?.content.match(/<article /g)).toHaveLength(40)
    for (let index = 0; index < 40; index++) {
      expect(report.attachment?.content).toContain(`Full detail marker ${index}.`)
    }
  })

  it('keeps full snapshot content in the attachment when the email excerpt is shortened', () => {
    const report = renderManagerReport({ ...input, entries: [entry({
      section: 'private_bookings', subject: 'Private bookings, weekly summary',
      text: 'Booking example. '.repeat(100) + 'Final booking: Example Hall.',
    })] })
    expect(report.html).not.toContain('Final booking: Example Hall.')
    expect(report.attachment?.content).toContain('Final booking: Example Hall.')
    expect(report.text).toContain('Some details are shortened above.')
  })

  it('keeps the report window at 09:00 London across the autumn clock change', () => {
    const report = renderManagerReport({ ...input, entries: [entry({ createdAt: '2026-10-23T23:30:00Z' })] })
    expect(report.text).toContain('23 Oct 2026, 09:00 to 30 Oct 2026, 09:00 (London)')
    expect(report.text).toContain('Recorded: 24 Oct 2026, 00:30 (London)')
  })

  it('formats the spring clock change in London and handles an invalid source date', () => {
    const report = renderManagerReport({
      ...input, periodStart: '2026-03-27T09:00:00Z', periodEnd: '2026-04-03T08:00:00Z',
      entries: [entry({ createdAt: 'broken' })],
    })
    expect(report.text).toContain('27 Mar 2026, 09:00 to 3 Apr 2026, 09:00 (London)')
    expect(report.text).toContain('Recorded: Date unavailable')
    expect(report.html).not.toContain('Invalid Date')
  })

  it('rejects unsafe app URLs and invalid report dates', () => {
    for (const appUrl of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.test']) {
      expect(() => renderManagerReport({ ...input, appUrl })).toThrow()
    }
    expect(() => renderManagerReport({ ...input, periodEnd: 'broken' })).toThrow('valid period dates')
  })

  it('retains table detail from HTML even when its text alternative only includes a reference', () => {
    const report = renderManagerReport({ ...input, entries: [entry({ text: 'Booking TEST-123' })] })
    expect(report.text).toContain('When: Saturday 31 October 2026 at 18:30')
    expect(report.text).toContain('Party size: 6')
  })

  it('keeps HTML tables legible as plain text and never emits an em dash', () => {
    const report = renderManagerReport({ ...input, entries: [entry({
      section: 'rota', subject: 'Rota \u2014 summary',
      html: '<table><tr><th>Week</th><th>Open shifts</th></tr><tr><td>26 October</td><td>0</td></tr></table>',
    })] })
    expect(report.text).toContain('Week | Open shifts')
    expect(report.text).toContain('26 October | 0')
    expect(report.html).not.toContain('\u2014')
  })

  it('shows available snapshot metrics including zero and excludes invalid numeric metadata', () => {
    const report = renderManagerReport({ ...input, entries: [entry({
      section: 'rota', subject: 'Rota summary', text: 'No unfilled shifts at snapshot time.',
      metadata: { weeks_needing_attention: 0, unfilled_shifts: 0, pending_leave: NaN },
    }), entry({
      id: 'private', section: 'private_bookings', subject: 'Private booking summary', text: 'Review the coming events.',
      metadata: { event_count: 4, action_count: 1 },
    })] })
    expect(report.text).toContain('Weeks needing attention: 0')
    expect(report.text).toContain('Unfilled shifts: 0')
    expect(report.text).toContain('Events in summary: 4')
    expect(report.text).toContain('Actions in summary: 1')
    expect(report.text).not.toContain('NaN')
  })

  it('bounds encoded email size and accounts for all skipped entries across a very long week', () => {
    const entries = MANAGER_REPORT_SECTIONS.flatMap((section) => Array.from({ length: 12 }, (_, index) => entry({
      id: `${section}-${index}`, key: `${section}-${index}`, section,
      subject: `Example ${section} ${index}: ${'&'.repeat(200)}`,
      html: undefined, text: `Recorded details: ${'&'.repeat(1500)}`,
    })))
    const report = renderManagerReport({ ...input, entries })
    expect(new TextEncoder().encode(report.html).byteLength).toBeLessThan(85_000)
    expect(report.attachment?.content.match(/<article /g)).toHaveLength(96)
    const visible = report.html.match(/<article /g)?.length ?? 0
    const omitted = [...report.text.matchAll(/(\d+) more updates are included/g)]
      .reduce((total, match) => total + Number(match[1]), 0)
    expect(visible + omitted).toBe(96)
  })
})
