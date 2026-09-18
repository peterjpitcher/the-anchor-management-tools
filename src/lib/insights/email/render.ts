import { EMAIL_BUDGET } from '../thresholds'
import { formatDateWithYear, formatDayDate, formatLondonClock, formatWeekday } from '../format'
import { scoreSignal } from '../signals'
import type { InsightSection, InsightSignal, InsightsReport, Rag, RankedAction, SectionStatus } from '../types'

/**
 * The Friday manager email (spec 7). Exception-first: the summary, every section's status
 * and headline, the highest-priority exceptions across the whole report, and the manager
 * actions. The full detail stays on the Insights page.
 *
 * Built to print: white everywhere (no background colour on any element), dark text, real
 * <ul>/<ol> lists that Outlook keeps, and a word beside every status emoji so the status
 * survives a black-and-white printer.
 */

export interface InsightsEmail {
  subject: string
  html: string
  text: string
  /** Exception rows shown, after any trimming to fit the size limit. */
  rowsShown: number
}

const STATUS_LABEL: Record<SectionStatus, string> = {
  red: '🔴 Action',
  amber: '🟠 Watch',
  green: '🟢 OK',
  not_checked: '⚪ Not checked',
}

const RAG_MARK: Record<Rag, string> = { red: '🔴', amber: '🟠', green: '🟢' }
const MAX_MEMBERS = 8
const TEXT = '#111111'
const MUTED = '#444444'
const RULE = '#999999'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

/** Removes control characters and long dashes from report text before output. */
function clean(value: string): string {
  return value
    // A long dash between words (as in some campaign names) becomes a comma, spaces and all.
    .replace(new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, 'g'), ', ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Row {
  sectionIndex: number
  signalIndex: number
  signal: InsightSignal
  text: string
  href?: string
  score: number
}

/** A signal row is printable when its text is email safe or it carries an action (always safe). */
function printableText(signal: InsightSignal): string | null {
  if (signal.kind === 'info') return null
  if (signal.emailSafe) return signal.text
  return signal.action?.text ?? null
}

function selectRows(report: InsightsReport, budget: number): Map<number, Row[]> {
  const rows: Row[] = []
  report.sections.forEach((section, sectionIndex) => {
    if (section.status === 'not_checked') return
    section.signals.forEach((signal, signalIndex) => {
      const text = printableText(signal)
      if (!text) return
      rows.push({ sectionIndex, signalIndex, signal, text, href: signal.action?.href, score: scoreSignal(signal, report.windows.today) })
    })
  })
  rows.sort((a, b) => b.score - a.score || a.sectionIndex - b.sectionIndex || a.signalIndex - b.signalIndex)
  const chosen = new Map<number, Row[]>()
  for (const row of rows.slice(0, Math.max(0, budget))) {
    chosen.set(row.sectionIndex, [...(chosen.get(row.sectionIndex) ?? []), row])
  }
  for (const list of chosen.values()) list.sort((a, b) => a.signalIndex - b.signalIndex)
  return chosen
}

function sectionCandidates(section: InsightSection): InsightSignal[] {
  return section.signals.filter((signal) => printableText(signal) !== null)
}

function makeLinker(appOrigin: string): (href: string | undefined) => string | null {
  return (href) => {
    if (!href) return null
    try {
      const url = new URL(href)
      return url.origin === appOrigin ? url.href : null
    } catch {
      return null
    }
  }
}

function subjectFor(report: InsightsReport): string {
  const { counts } = report.summary
  const parts = [`${counts.red} action`, `${counts.amber} watch`]
  if (counts.not_checked > 0) parts.push(`${counts.not_checked} not checked`)
  return `The Anchor weekly report, ${formatDayDate(report.windows.today)}: ${parts.join(', ')}`
}

function renderHtml(report: InsightsReport, appOrigin: string, budget: number): { html: string; rowsShown: number } {
  const link = makeLinker(appOrigin)
  const anchor = (href: string | undefined, label: string): string => {
    const safe = link(href)
    return safe ? ` <a href="${escapeHtml(safe)}" style="color:${TEXT}">${escapeHtml(label)}</a>` : ''
  }
  const chosen = selectRows(report, budget)
  const { windows, summary } = report
  const generated = new Date(report.generatedAt)
  const insightsUrl = `${appOrigin}/insights`
  const out: string[] = []
  let rowsShown = 0

  const heading = (text: string): string =>
    `<h2 style="font-size:16px;line-height:1.3;margin:22px 0 6px;padding-top:12px;border-top:1px solid ${RULE};color:${TEXT}">${escapeHtml(text)}</h2>`
  const para = (html: string, muted = false): string =>
    `<p style="margin:0 0 8px;color:${muted ? MUTED : TEXT}">${html}</p>`
  const list = (items: string[], ordered = false): string => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:0 0 10px;padding-left:22px;color:${TEXT}">${items.map((item) => `<li style="margin:0 0 5px">${item}</li>`).join('')}</${tag}>`
  }

  out.push(`<p style="margin:0;font-size:12px;letter-spacing:1px;color:${MUTED}">THE ANCHOR</p>`)
  out.push(`<h1 style="font-size:22px;line-height:1.25;margin:4px 0 6px;color:${TEXT}">Weekly manager report</h1>`)
  out.push(para(escapeHtml(`${formatWeekday(windows.today)} ${formatDateWithYear(windows.today)}, as of ${formatLondonClock(generated)}. Covers ${formatDayDate(windows.thisWeek.start)} to ${formatDayDate(windows.thisWeek.end)} and looks ahead to ${formatDayDate(windows.next14.end)}.`), true))

  // Summary
  out.push(heading('Summary'))
  const counts = summary.counts
  out.push(para(escapeHtml(`${STATUS_LABEL.red} ${counts.red} · ${STATUS_LABEL.amber} ${counts.amber} · ${STATUS_LABEL.green} ${counts.green} · ${STATUS_LABEL.not_checked} ${counts.not_checked}`)))
  const summaryItems = [
    `<strong>Biggest win:</strong> ${escapeHtml(clean(summary.biggestWin?.text ?? 'No standout win this week.'))}`,
    `<strong>Biggest concern:</strong> ${escapeHtml(clean(summary.biggestConcern?.text ?? 'Nothing needs attention.'))}`,
    `<strong>Most urgent action:</strong> ${summary.mostUrgentAction ? `${escapeHtml(clean(summary.mostUrgentAction.text))}${anchor(summary.mostUrgentAction.href, 'Open')}` : 'None this week.'}`,
    `<strong>Coming up:</strong> ${summary.comingUp ? `${escapeHtml(clean(summary.comingUp.text))}${anchor(summary.comingUp.href, 'Open')}` : 'Nothing booked in the next 7 days needs preparing.'}`,
  ]
  out.push(list(summaryItems))
  if (report.notChecked.length > 0) {
    const names = report.sections.filter((section) => section.status === 'not_checked').map((section) => section.title)
    out.push(para(`<strong>${escapeHtml(`Not checked: ${names.join(', ')}.`)}</strong> ${escapeHtml('The data could not be read when this report was built. Open the Insights page before the meeting.')}`))
  }
  out.push(para(`Full detail:${anchor(insightsUrl, 'open the Insights page')}`, true))

  // Sections
  report.sections.forEach((section, sectionIndex) => {
    out.push(heading(`${STATUS_LABEL[section.status]}: ${section.title}`))
    out.push(para(escapeHtml(clean(section.headline))))
    const metrics = section.metrics.slice(0, EMAIL_BUDGET.metricsPerSection)
    if (metrics.length > 0) {
      const cell = `border:1px solid ${RULE};padding:4px 8px;vertical-align:top;color:${TEXT}`
      out.push(`<table role="presentation" style="border-collapse:collapse;margin:0 0 10px;font-size:13px">${metrics.map((metric) =>
        `<tr><td style="${cell}">${escapeHtml(clean(metric.label))}</td>${metric.comparison
          ? `<td style="${cell}"><strong>${escapeHtml(clean(metric.value))}</strong></td><td style="${cell}">${escapeHtml(clean(metric.comparison))}</td>`
          : `<td style="${cell}" colspan="2"><strong>${escapeHtml(clean(metric.value))}</strong></td>`}</tr>`).join('')}</table>`)
    }
    const rows = chosen.get(sectionIndex) ?? []
    rowsShown += rows.length
    if (rows.length > 0) {
      out.push(list(rows.map((row) => `${RAG_MARK[row.signal.kind === 'win' ? 'green' : row.signal.rag]} ${escapeHtml(clean(row.text))}${anchor(row.href, 'Open')}`)))
    }
    const candidates = sectionCandidates(section)
    const hidden = candidates.length - rows.length
    if (hidden > 0) {
      const shownKeys = new Set(rows.map((row) => row.signal.key))
      const hiddenReds = candidates.filter((signal) => !shownKeys.has(signal.key) && signal.kind === 'issue' && signal.rag === 'red').length
      const label = hiddenReds > 0
        ? `${hidden} more on the Insights page, including ${hiddenReds} to action.`
        : `${hidden} more on the Insights page.`
      out.push(para(`${escapeHtml(label)}${anchor(`${insightsUrl}#${section.key}`, 'Open')}`, true))
    }
    for (const note of section.notes) out.push(para(escapeHtml(clean(note)), true))
    out.push(para(anchor(section.href, `Open ${section.title.toLowerCase()}`).trim(), true))
  })

  // Manager actions
  out.push(heading('Manager actions this week'))
  if (report.actions.length === 0) {
    out.push(para('No actions this week.'))
  } else {
    out.push(list(report.actions.map((action) => renderAction(action, anchor)), true))
  }
  if (report.moreRedActions > 0) {
    out.push(para(escapeHtml(`Plus ${report.moreRedActions} more to action, shown in their sections and on the Insights page.`)))
  }

  out.push(`<p style="margin:24px 0 0;padding-top:10px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED}">${escapeHtml('Printed copies contain staff and customer details. Shred after the meeting.')}</p>`)

  const title = escapeHtml(subjectFor(report))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head><body style="margin:0;padding:0;color:${TEXT};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45"><div style="max-width:680px;margin:0 auto;padding:16px;overflow-wrap:anywhere">${out.join('\n')}</div></body></html>`
  return { html, rowsShown }
}

function renderAction(action: RankedAction, anchor: (href: string | undefined, label: string) => string): string {
  const status = action.kind === 'win' ? STATUS_LABEL.green : STATUS_LABEL[action.rag]
  const members = action.members ?? []
  const shown = members.slice(0, MAX_MEMBERS)
  const more = members.length - shown.length
  const memberList = shown.length > 0
    ? `<ul style="margin:4px 0 0;padding-left:20px">${shown.map((member) => `<li style="margin:0 0 3px">${escapeHtml(clean(member))}</li>`).join('')}${more > 0 ? `<li style="margin:0 0 3px">${escapeHtml(`and ${more} more`)}</li>` : ''}</ul>`
    : ''
  return `${escapeHtml(status)}: ${escapeHtml(clean(action.text))}${anchor(action.href, 'Open')}${memberList}`
}

function renderText(report: InsightsReport, appOrigin: string, budget: number): string {
  const link = makeLinker(appOrigin)
  const chosen = selectRows(report, budget)
  const { windows, summary } = report
  const generated = new Date(report.generatedAt)
  const lines: string[] = []
  const withLink = (text: string, href?: string): string => {
    const safe = link(href)
    return safe ? `${text} (${safe})` : text
  }

  lines.push('THE ANCHOR: WEEKLY MANAGER REPORT')
  lines.push(`${formatWeekday(windows.today)} ${formatDateWithYear(windows.today)}, as of ${formatLondonClock(generated)}. Covers ${formatDayDate(windows.thisWeek.start)} to ${formatDayDate(windows.thisWeek.end)} and looks ahead to ${formatDayDate(windows.next14.end)}.`)
  lines.push('', 'SUMMARY')
  const c = summary.counts
  lines.push(`${STATUS_LABEL.red} ${c.red} · ${STATUS_LABEL.amber} ${c.amber} · ${STATUS_LABEL.green} ${c.green} · ${STATUS_LABEL.not_checked} ${c.not_checked}`)
  lines.push(`- Biggest win: ${clean(summary.biggestWin?.text ?? 'No standout win this week.')}`)
  lines.push(`- Biggest concern: ${clean(summary.biggestConcern?.text ?? 'Nothing needs attention.')}`)
  lines.push(`- Most urgent action: ${summary.mostUrgentAction ? withLink(clean(summary.mostUrgentAction.text), summary.mostUrgentAction.href) : 'None this week.'}`)
  lines.push(`- Coming up: ${summary.comingUp ? withLink(clean(summary.comingUp.text), summary.comingUp.href) : 'Nothing booked in the next 7 days needs preparing.'}`)
  if (report.notChecked.length > 0) {
    const names = report.sections.filter((section) => section.status === 'not_checked').map((section) => section.title)
    lines.push(`Not checked: ${names.join(', ')}. Open the Insights page before the meeting.`)
  }
  lines.push(`Full detail: ${appOrigin}/insights`)

  report.sections.forEach((section, sectionIndex) => {
    lines.push('', `${STATUS_LABEL[section.status]}: ${section.title.toUpperCase()}`)
    lines.push(clean(section.headline))
    for (const metric of section.metrics.slice(0, EMAIL_BUDGET.metricsPerSection)) {
      lines.push(`  ${clean(metric.label)}: ${clean(metric.value)}${metric.comparison ? ` (${clean(metric.comparison)})` : ''}`)
    }
    const rows = chosen.get(sectionIndex) ?? []
    for (const row of rows) {
      lines.push(`- ${RAG_MARK[row.signal.kind === 'win' ? 'green' : row.signal.rag]} ${withLink(clean(row.text), row.href)}`)
    }
    const hidden = sectionCandidates(section).length - rows.length
    if (hidden > 0) lines.push(`${hidden} more on the Insights page.`)
    for (const note of section.notes) lines.push(clean(note))
  })

  lines.push('', 'MANAGER ACTIONS THIS WEEK')
  if (report.actions.length === 0) lines.push('No actions this week.')
  report.actions.forEach((action, index) => {
    const status = action.kind === 'win' ? STATUS_LABEL.green : STATUS_LABEL[action.rag]
    lines.push(`${index + 1}. ${status}: ${withLink(clean(action.text), action.href)}`)
    const members = action.members ?? []
    for (const member of members.slice(0, MAX_MEMBERS)) lines.push(`   - ${clean(member)}`)
    if (members.length > MAX_MEMBERS) lines.push(`   - and ${members.length - MAX_MEMBERS} more`)
  })
  if (report.moreRedActions > 0) lines.push(`Plus ${report.moreRedActions} more to action, shown in their sections and on the Insights page.`)
  lines.push('', 'Printed copies contain staff and customer details. Shred after the meeting.')
  return lines.join('\n')
}

/**
 * Renders the report. Rows are cut back from the budget, lowest priority first, until the
 * HTML fits the size limit, so Gmail never clips the actions at the end.
 */
export function renderInsightsEmail(report: InsightsReport, options: { appUrl: string }): InsightsEmail {
  const appOrigin = new URL(options.appUrl).origin
  let budget: number = EMAIL_BUDGET.exceptionRows
  for (;;) {
    const { html, rowsShown } = renderHtml(report, appOrigin, budget)
    const bytes = new TextEncoder().encode(html).byteLength
    if (bytes <= EMAIL_BUDGET.maxBytes || budget === 0) {
      return { subject: subjectFor(report), html, text: renderText(report, appOrigin, budget), rowsShown }
    }
    budget = Math.max(0, budget - 5)
  }
}
