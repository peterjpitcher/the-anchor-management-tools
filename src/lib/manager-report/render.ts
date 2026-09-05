import { formatDateInLondon, parseLondonDateTimeLocal } from '@/lib/dateUtils'
import { MANAGER_REPORT_SECTIONS } from './types'
import type { ManagerReportEntry, ManagerReportRenderInput, ManagerReportRendered, ManagerReportSection } from './types'

const MAX_VISIBLE_ENTRIES = 12
// Leave room for headings, links and the notice below the usual inbox clipping
// threshold. Count encoded bytes, since escaped names can expand substantially.
const MAX_ENTRY_HTML_BYTES = 65_000
const SECTIONS: Record<ManagerReportSection, { title: string; path: string; snapshot?: boolean }> = {
  table_bookings: { title: 'New table bookings', path: '/table-bookings' },
  staff_shift_reminders: { title: 'Staff shift reminders', path: '/rota' },
  holiday_reminders: { title: 'Holiday approval reminders', path: '/rota/leave' },
  checklist_alerts: { title: 'Checklist alerts', path: '/checklists/manage' },
  checklist_summary: { title: 'Checklist summary', path: '/checklists/manage', snapshot: true },
  recruitment: { title: 'Recruitment', path: '/recruitment' },
  private_bookings: { title: 'Private-booking summary', path: '/private-bookings', snapshot: true },
  rota: { title: 'Rota summary', path: '/rota', snapshot: true },
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function cleanText(value: string): string {
  return value
    .replace(/\u2014/g, ', ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// This produces plain text only. Even malformed HTML and decoded markup are
// escaped again at every HTML output boundary; no source attributes are reused.
function htmlToText(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    pound: '£', ndash: '-', mdash: ', ', bull: '*', hellip: '...',
  }
  return cleanText(value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|head|iframe|object|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/(?:td|th)\s*>\s*<(?:td|th)\b[^>]*>/gi, ' | ')
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|li|tr|h[1-6]|section|table|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? entity
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : ''
    }))
}

function dateLabel(value: string, includeTime = false): string {
  const date = parseLondonDateTimeLocal(value)
  if (!date) return 'Date unavailable'
  return formatDateInLondon(date, {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}

function bodyText(entry: ManagerReportEntry): string {
  // Booking HTML contains the When and Party size fields even when a shorter
  // text alternative exists. Prefer it so the reference is never the only detail.
  return entry.section === 'table_bookings' && entry.html
    ? htmlToText(entry.html)
    : cleanText(entry.text ?? '') || htmlToText(entry.html ?? '')
}

function summarise(entry: ManagerReportEntry, body: string): string {
  if (entry.section === 'table_bookings') {
    const lines = body.split('\n')
    const details = ['When', 'Party size', 'Guest', 'Status', 'High chairs', 'Seating', 'Notes']
      .flatMap((label) => lines.filter((line) => line.startsWith(`${label}:`)))
    if (details.length) return details.join('\n')
  }
  return body
}

function snapshotMetrics(entry: ManagerReportEntry): string {
  const fields = entry.section === 'private_bookings'
    ? { event_count: 'Events in summary', action_count: 'Actions in summary' }
    : entry.section === 'rota'
      ? { weeks_needing_attention: 'Weeks needing attention', unfilled_shifts: 'Unfilled shifts', pending_leave: 'Holiday requests awaiting approval' }
      : {}
  return Object.entries(fields).flatMap(([key, label]) => {
    const value = entry.metadata?.[key]
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? [`${label}: ${value}`] : []
  }).join('\n')
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}...`
}

function page(title: string, contents: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f3f4f6;color:#1f2937;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5"><main style="max-width:680px;margin:24px auto;background:#fff;padding:28px 24px;border-radius:8px;overflow-wrap:anywhere">${contents}</main></body></html>`
}

/** Render stored notifications as escaped text; source HTML is never embedded. */
export function renderManagerReport(input: ManagerReportRenderInput): ManagerReportRendered {
  const appUrl = new URL(input.appUrl)
  if (!['https:', 'http:'].includes(appUrl.protocol) || appUrl.username || appUrl.password) {
    throw new Error('Manager report requires an HTTP or HTTPS app URL without credentials')
  }
  if (!parseLondonDateTimeLocal(input.periodStart) || !parseLondonDateTimeLocal(input.periodEnd)) {
    throw new Error('Manager report requires valid period dates')
  }
  const period = `${dateLabel(input.periodStart, true)} to ${dateLabel(input.periodEnd, true)} (London)`
  const subject = `The Anchor: Friday manager report, ${dateLabel(input.periodEnd)}`
  const totalLabel = `${input.entries.length} queued ${input.entries.length === 1 ? 'update' : 'updates'}`
  const introduction = 'Updates recorded during this period. Reminders and snapshots reflect their recorded date; check the management app for the current position.'
  const header = `<p style="margin:0;color:#6b7280;font-size:12px;letter-spacing:1px">THE ANCHOR</p><h1 style="font-size:25px;margin:6px 0 12px">Friday manager report</h1><p>${escapeHtml(period)}<br><strong>${totalLabel}</strong></p><p style="color:#4b5563">${introduction}</p>`
  const html: string[] = [header]
  const full: string[] = [header, '<h2>Full details</h2>']
  const text: string[] = [subject, period, totalLabel, introduction]
  let needsAttachment = false
  let visibleEntryBytes = 0

  for (const section of MANAGER_REPORT_SECTIONS) {
    const definition = SECTIONS[section]
    const entries = input.entries.filter((entry) => entry.section === section)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    const url = new URL(definition.path, appUrl.origin).href
    const unit = definition.snapshot ? 'snapshot' : 'update'
    const label = `${definition.title} (${entries.length} ${unit}${entries.length === 1 ? '' : 's'})`
    const link = `<a href="${escapeHtml(url)}" style="color:#1d4ed8">Open ${escapeHtml(definition.title.toLowerCase())}</a>`
    const heading = `<h2 style="font-size:19px;border-top:1px solid #e5e7eb;padding-top:18px;margin:24px 0 12px">${escapeHtml(label)}</h2>`
    html.push(heading)
    full.push(heading)
    text.push(`\n${label}`, url)
    if (!entries.length) {
      const empty = definition.snapshot
        ? 'No snapshot available for this report; check the management app.'
        : 'No queued updates in this period.'
      html.push(`<p style="color:#6b7280">${empty}</p>`)
      full.push(`<p>${empty}</p>`)
      text.push(empty)
    }
    let visibleCount = 0
    entries.forEach((entry) => {
      const title = cleanText(entry.subject) || 'Update'
      const sourceRecordedAt = typeof entry.metadata?.source_recorded_at === 'string'
        ? entry.metadata.source_recorded_at : entry.createdAt
      const recorded = `${definition.snapshot ? 'Snapshot' : 'Recorded'}: ${dateLabel(sourceRecordedAt, true)} (London)`
      const body = bodyText(entry)
      const metrics = snapshotMetrics(entry)
      const fullBody = [metrics, body].filter(Boolean).join('\n\n')
      const concise = clip([metrics, summarise(entry, body)].filter(Boolean).join('\n\n'), definition.snapshot ? 900 : 420)
      const item = (details: string, itemTitle: string): string => `<article style="margin:0 0 18px"><h3 style="font-size:15px;margin:0 0 3px">${escapeHtml(itemTitle)}</h3><p style="font-size:12px;color:#6b7280;margin:0 0 6px">${escapeHtml(recorded)}</p><p style="margin:0;white-space:pre-line">${escapeHtml(details || 'See the management app for details.')}</p></article>`
      full.push(item(fullBody, title))
      const visibleTitle = clip(title, 150)
      const visibleHtml = item(concise, visibleTitle)
      const itemBytes = new TextEncoder().encode(visibleHtml).byteLength
      if (visibleCount < MAX_VISIBLE_ENTRIES && visibleEntryBytes + itemBytes <= MAX_ENTRY_HTML_BYTES) {
        visibleCount++
        visibleEntryBytes += itemBytes
        html.push(visibleHtml)
        text.push(visibleTitle, recorded, concise || 'See the management app for details.')
        if (concise !== fullBody || visibleTitle !== title) needsAttachment = true
      } else {
        needsAttachment = true
      }
    })
    if (entries.length > visibleCount) {
      const omitted = `${entries.length - visibleCount} more updates are included in the attached full report.`
      html.push(`<p><strong>${omitted}</strong></p>`)
      text.push(omitted)
    }
    html.push(`<p>${link}</p>`)
    full.push(`<p>${link}</p>`)
  }
  if (needsAttachment) {
    const note = 'Some details are shortened above. The attached full report contains every queued update and its full text.'
    html.splice(1, 0, `<p style="padding:12px;background:#f3f4f6">${note}</p>`)
    text.splice(4, 0, note)
  }
  return {
    subject,
    html: page(subject, html.join('\n')),
    text: text.join('\n\n'),
    ...(needsAttachment ? {
      attachment: {
        filename: 'friday-manager-report-full.html',
        contentType: 'text/html',
        content: page(`${subject}: full details`, full.join('\n')),
      },
    } : {}),
  }
}
