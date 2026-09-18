import Link from 'next/link'
import { PageHeader } from '@/ds'
import { formatDateWithYear, formatDayDate, formatLondonClock, formatWeekday } from '@/lib/insights/format'
import type { InsightAction, InsightList, InsightSection, InsightSignal, InsightsReport, Rag, SectionStatus } from '@/lib/insights/types'
import { cn } from '@/lib/utils'
import { InsightsToolbar } from './InsightsToolbar'

/**
 * The Insights page (spec 6). Server-rendered from one report object; no client code
 * fetches report data. Built to print: the app chrome and buttons hide, backgrounds and
 * shadows drop, long lists print in full, and every status carries a word, not just colour.
 */

const STATUS_WORD: Record<SectionStatus, string> = { red: 'Action', amber: 'Watch', green: 'OK', not_checked: 'Not checked' }
const STATUS_EMOJI: Record<SectionStatus, string> = { red: '🔴', amber: '🟠', green: '🟢', not_checked: '⚪' }
const STATUS_TEXT: Record<SectionStatus, string> = {
  red: 'text-danger-fg',
  amber: 'text-warning-fg',
  green: 'text-success-fg',
  not_checked: 'text-text-muted',
}
const LIST_VISIBLE = 10

/** Report links are absolute on the configured app origin; on the page they stay on this host. */
function appPath(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function StatusLabel({ status, className }: { status: SectionStatus; className?: string }): React.JSX.Element {
  return (
    <span className={cn('font-semibold print:text-text-strong', STATUS_TEXT[status], className)}>
      <span aria-hidden="true">{STATUS_EMOJI[status]}</span> {STATUS_WORD[status]}
    </span>
  )
}

function signalStatus(signal: InsightSignal): Rag {
  return signal.kind === 'win' ? 'green' : signal.rag
}

function OpenLink({ href, label = 'Open' }: { href: string | undefined; label?: string }): React.JSX.Element | null {
  const path = appPath(href)
  if (!path) return null
  return (
    <Link href={path} className="ml-1 font-medium text-primary underline underline-offset-2 print:text-text-strong">
      {label}
    </Link>
  )
}

function Members({ action }: { action: InsightAction | undefined }): React.JSX.Element | null {
  if (!action?.members?.length) return null
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text-muted print:text-text-strong">
      {action.members.map((member, index) => <li key={`${index}-${member}`}>{member}</li>)}
    </ul>
  )
}

function SignalList({ title, signals }: { title: string; signals: InsightSignal[] }): React.JSX.Element | null {
  if (signals.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-text-strong">{title}</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        {signals.map((signal, index) => (
          <li key={`${index}-${signal.key}`}>
            <StatusLabel status={signalStatus(signal)} className="mr-1" />
            <span>{signal.text}</span>
            {signal.action && (
              <span className="block text-text-muted print:text-text-strong">
                {signal.action.text}
                <OpenLink href={signal.action.href} />
              </span>
            )}
            <Members action={signal.action} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ListItems({ items, className }: { items: InsightList['items']; className?: string }): React.JSX.Element {
  return (
    <>
      {items.map((item, index) => (
        <li key={`${item.text}-${index}`} className={className}>
          {item.rag && <StatusLabel status={item.rag} className="mr-1" />}
          <span>{item.text}</span>
          <OpenLink href={item.href} />
        </li>
      ))}
    </>
  )
}

function SectionList({ list }: { list: InsightList }): React.JSX.Element | null {
  if (list.items.length === 0 && !list.emptyText) return null
  if (list.collapsed && list.items.length > 0) {
    // A reference list that repeats the exception lists above: closed on screen, left off paper.
    return (
      <details className="text-sm print:hidden">
        <summary className="cursor-pointer font-semibold text-text-strong">
          {list.title} <span className="font-medium text-primary">(show all {list.items.length})</span>
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <ListItems items={list.items} />
        </ul>
      </details>
    )
  }
  const visible = list.items.slice(0, LIST_VISIBLE)
  const rest = list.items.slice(LIST_VISIBLE)
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-text-strong">{list.title}</h3>
      {list.items.length === 0 ? (
        <p className="text-sm text-text-muted">{list.emptyText}</p>
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <ListItems items={visible} />
            {/* The rest prints in full; on screen it sits behind "Show all". */}
            {rest.length > 0 && <ListItems items={rest} className="hidden print:list-item" />}
          </ul>
          {rest.length > 0 && (
            <details className="mt-1 text-sm print:hidden">
              <summary className="cursor-pointer font-medium text-primary">Show all {list.items.length}</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <ListItems items={rest} />
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function SectionCard({ section }: { section: InsightSection }): React.JSX.Element {
  const issues = section.signals.filter((signal) => signal.kind === 'issue')
  const wins = section.signals.filter((signal) => signal.kind === 'win')
  const info = section.signals.filter((signal) => signal.kind === 'info')
  const sectionPath = appPath(section.href)
  return (
    <section
      id={section.key}
      aria-labelledby={`${section.key}-title`}
      className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 shadow-sm print:break-inside-avoid-page print:rounded-none print:border-0 print:border-t print:border-border-strong print:bg-transparent print:px-0 print:shadow-none"
    >
      <h2 id={`${section.key}-title`} className="text-base font-semibold text-text-strong">
        <StatusLabel status={section.status} />
        <span>: {section.title}</span>
      </h2>
      <p className="mt-1 text-sm text-text">{section.headline}</p>

      {section.metrics.length > 0 && (
        // On a phone the figures scroll inside the card rather than widening the page.
        <div className="mt-3 max-w-2xl overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {section.metrics.map((metric, index) => (
              <tr key={`${index}-${metric.label}`} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-1 pr-3 text-left align-top font-normal text-text-muted print:text-text-strong">{metric.label}</th>
                <td className="py-1 pr-3 align-top font-semibold text-text-strong">{metric.value}</td>
                <td className="min-w-[12rem] py-1 align-top text-text-muted print:text-text-strong">{metric.comparison ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <SignalList title="Needs attention" signals={issues} />
        <SignalList title="Going well" signals={wins} />
        {info.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted print:text-text-strong">
            {info.map((signal, index) => <li key={`${index}-${signal.key}`}>{signal.text}</li>)}
          </ul>
        )}
        {section.lists.map((list, index) => <SectionList key={`${index}-${list.title}`} list={list} />)}
        {section.notes.length > 0 && (
          <ul className="space-y-0.5 text-xs text-text-muted print:text-text-strong">
            {section.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
          </ul>
        )}
      </div>

      {sectionPath && (
        <p className="mt-3 text-sm print:hidden">
          <Link href={sectionPath} className="font-medium text-primary underline underline-offset-2">
            Open {section.title.toLowerCase()}
          </Link>
        </p>
      )}
    </section>
  )
}

export function InsightsReportView({ report }: { report: InsightsReport }): React.JSX.Element {
  const { windows, summary } = report
  const generated = new Date(report.generatedAt)
  const subtitle = `As of ${formatLondonClock(generated)} on ${formatWeekday(windows.today)} ${formatDateWithYear(windows.today)}. `
    + `Looks back over ${formatDayDate(windows.thisWeek.start)} to ${formatDayDate(windows.thisWeek.end)} and ahead to ${formatDayDate(windows.next14.end)}.`
  const notChecked = report.sections.filter((section) => section.status === 'not_checked')

  return (
    <div className="space-y-5 print:space-y-3 print:text-text-strong">
      <PageHeader
        breadcrumbs={[{ label: 'Insights' }]}
        title="Insights"
        subtitle={subtitle}
        actions={<InsightsToolbar />}
        className="mb-0 pb-0"
      />

      <section aria-labelledby="summary-title" className="rounded-lg border border-border bg-surface p-4 shadow-sm print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none">
        <h2 id="summary-title" className="text-base font-semibold text-text-strong">Summary</h2>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {(['red', 'amber', 'green', 'not_checked'] as const).map((status) => (
            <span key={status}>
              <StatusLabel status={status} /> {summary.counts[status]}
            </span>
          ))}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li><strong>Biggest win:</strong> {summary.biggestWin?.text ?? 'No standout win this week.'}</li>
          <li><strong>Biggest concern:</strong> {summary.biggestConcern?.text ?? 'Nothing needs attention.'}</li>
          <li>
            <strong>Most urgent action:</strong> {summary.mostUrgentAction?.text ?? 'None this week.'}
            <OpenLink href={summary.mostUrgentAction?.href} />
          </li>
          <li>
            <strong>Coming up:</strong> {summary.comingUp?.text ?? 'Nothing booked in the next 7 days needs preparing.'}
            <OpenLink href={summary.comingUp?.href} />
          </li>
        </ul>
        {notChecked.length > 0 && (
          <p className="mt-2 text-sm font-semibold text-danger-fg print:text-text-strong" role="alert">
            Not checked: {notChecked.map((section) => section.title).join(', ')}. The data could not be read. Refresh, or open those sections directly.
          </p>
        )}
      </section>

      <nav aria-label="Report sections" className="print:hidden">
        <ul className="flex flex-wrap gap-2 text-sm">
          {report.sections.map((section) => (
            <li key={section.key}>
              <a
                href={`#${section.key}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-border-focus"
              >
                <span aria-hidden="true">{STATUS_EMOJI[section.status]}</span>
                <span>{section.title}</span>
                <span className="sr-only">: {STATUS_WORD[section.status]}</span>
              </a>
            </li>
          ))}
          <li>
            <a href="#actions" className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-1 text-text hover:bg-surface-hover">
              Manager actions
            </a>
          </li>
        </ul>
      </nav>

      {report.sections.map((section) => <SectionCard key={section.key} section={section} />)}

      <section
        id="actions"
        aria-labelledby="actions-title"
        className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 shadow-sm print:break-inside-avoid-page print:rounded-none print:border-0 print:border-t print:border-border-strong print:bg-transparent print:px-0 print:shadow-none"
      >
        <h2 id="actions-title" className="text-base font-semibold text-text-strong">Manager actions this week</h2>
        {report.actions.length === 0 ? (
          <p className="mt-1 text-sm">No actions this week.</p>
        ) : (
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {report.actions.map((action, index) => (
              <li key={`${index}-${action.sectionKey}-${action.signalKey}`}>
                <StatusLabel status={action.kind === 'win' ? 'green' : action.rag} />
                <span>: {action.text}</span>
                <OpenLink href={action.href} />
                <span className="ml-1 text-text-muted print:text-text-strong">({action.sectionTitle})</span>
                <Members action={action} />
              </li>
            ))}
          </ol>
        )}
        {report.moreRedActions > 0 && (
          <p className="mt-2 text-sm">Plus {report.moreRedActions} more to action, shown in their sections above.</p>
        )}
      </section>

      <p className="text-xs text-text-muted print:text-text-strong">
        Built from live data when this page was opened. Printed copies contain staff and customer details: shred after the meeting.
      </p>
    </div>
  )
}
