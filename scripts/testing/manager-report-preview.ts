/** Local synthetic rendering only. No database queries, provider calls or sends. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderManagerReport } from '../../src/lib/manager-report/render'
import type { ManagerReportEntry } from '../../src/lib/manager-report/types'

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error('Pass an output directory for the synthetic preview')

const base = {
  to: 'manager@example.test',
  createdAt: '2026-09-11T07:00:00Z',
}
const entries: ManagerReportEntry[] = [
  {
    ...base, id: 'booking-1', key: 'booking-1', section: 'table_bookings',
    subject: 'New table booking: EXAMPLE-101',
    createdAt: '2026-09-09T14:30:00Z',
    html: '<p>A new table booking has been created.</p><ul><li><strong>Reference:</strong> EXAMPLE-101</li><li><strong>When:</strong> Saturday 12 September 2026 at 18:30</li><li><strong>Party size:</strong> 6</li><li><strong>Guest:</strong> Alex Example</li><li><strong>Status:</strong> Confirmed</li><li><strong>Notes:</strong> One high chair requested.</li></ul>',
  },
  {
    ...base, id: 'booking-2', key: 'booking-2', section: 'table_bookings',
    subject: 'New table booking: EXAMPLE-102',
    createdAt: '2026-09-10T10:45:00Z',
    html: '<ul><li><strong>When:</strong> Sunday 13 September 2026 at 13:00</li><li><strong>Party size:</strong> 4</li><li><strong>Guest:</strong> Sam Sample</li><li><strong>Status:</strong> Confirmed</li></ul>',
  },
  {
    ...base, id: 'shift-1', key: 'shift-1', section: 'staff_shift_reminders',
    subject: 'Shift acceptance reminder: Jamie Example',
    text: 'Jamie Example received a reminder to accept the Saturday 12 September, 17:00 to 23:00 bar shift. Acceptance was outstanding when the reminder was recorded.',
  },
  {
    ...base, id: 'holiday-1', key: 'holiday-1', section: 'holiday_reminders',
    subject: 'Holiday request awaiting approval: Robin Sample',
    text: 'Requested dates: 21 to 23 September 2026. This request was awaiting a manager decision when the reminder was recorded.',
  },
  {
    ...base, id: 'checklist-alert-1', key: 'checklist-alert-1', section: 'checklist_alerts',
    subject: 'Checklist: closing task missed',
    text: 'The bar closing checklist recorded one missed task on 9 September. Review the task record and follow-up notes.',
  },
  {
    ...base, id: 'checklist-summary-1', key: 'checklist-summary-1', section: 'checklist_summary',
    subject: 'Checklist summary, week to 11 September 2026',
    html: '<h2>Checklists, week to 11 September 2026</h2><p>Completion: 96% (48 done, 2 missed, 1 late).</p><p>Spot checks recorded: 10 of 10 expected.</p><h3>Readings out of range (0)</h3><p>None.</p>',
  },
  {
    ...base, id: 'recruitment-1', key: 'recruitment-1', section: 'recruitment',
    subject: 'Recruitment: new application to review',
    text: 'Taylor Example applied for a bar team role. Review the application and recorded assessment in Recruitment.',
  },
  {
    ...base, id: 'private-summary-1', key: 'private-summary-1', section: 'private_bookings',
    subject: 'Private bookings: coming events and actions',
    metadata: { event_count: 2, action_count: 1 },
    text: 'Saturday 12 September: Example family celebration, 30 guests. Final catering numbers awaiting confirmation.\nSunday 20 September: Sample community lunch, 20 guests. No outstanding action recorded.',
  },
  {
    ...base, id: 'rota-summary-1', key: 'rota-summary-1', section: 'rota',
    subject: 'Rota: one week needs attention',
    metadata: { weeks_needing_attention: 1, unfilled_shifts: 0, pending_leave: 1 },
    text: 'Week beginning 14 September: the draft rota has not been published.\nNo unfilled shifts recorded at snapshot time.\nOne holiday request was awaiting approval.',
  },
]

async function main(): Promise<void> {
  const report = renderManagerReport({
    entries,
    periodStart: '2026-09-04T08:00:00Z',
    periodEnd: '2026-09-11T08:00:00Z',
    appUrl: 'https://management.example.test',
  })
  if (/undefined|Invalid Date|NaN/.test(report.html + report.text)) {
    throw new Error('Synthetic preview contains an invalid rendered value')
  }
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'friday-report-preview.html'), report.html, 'utf8')
  await writeFile(join(outputDirectory, 'friday-report-preview.txt'), report.text, 'utf8')
  if (report.attachment) {
    await writeFile(join(outputDirectory, report.attachment.filename), report.attachment.content, 'utf8')
  }
}

void main()
