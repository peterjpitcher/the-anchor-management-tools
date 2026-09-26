import Link from 'next/link'
import { Card, CardBody, CardHeader, LinkButton, PageLayout, Table, TableBody, TableCell, TableRow } from '@/ds'
import { formatDateWithYear, formatDayDate, formatLondonClock, formatWeekday } from '@/lib/insights/format'
import type { InsightAction, InsightList, InsightSection, InsightSignal, InsightsReport, Rag, SectionStatus } from '@/lib/insights/types'
import { cn } from '@/lib/utils'
import { INSIGHT_STATUS_EMOJI, INSIGHT_STATUS_TEXT, INSIGHT_STATUS_WORD } from '../_shared/status-ui'
import { INSIGHTS_LAYOUT } from '../_shared/layout'
import { insightSectionTitle } from '../_shared/title'
import { InsightsToolbar } from './InsightsToolbar'

/**
 * The Insights page (spec 6). Server-rendered from one report object; no client code
 * fetches report data. Built to print: the app chrome and buttons hide, backgrounds and
 * shadows drop, long lists print in full, and every status carries a word, not just colour.
 */

const LIST_VISIBLE = 10

/*
 * Print rules for the report cards. On screen each block is a DS Card; on paper the frame,
 * fill and shadow drop, a rule separates the blocks, the text runs to the page margin, and
 * nothing is clipped where a card breaks across pages.
 */
const PRINT_CARD = 'print:overflow-visible print:rounded-none print:border-0 print:border-t print:border-border-strong print:bg-transparent print:shadow-none'
const PRINT_CARD_HEADER = 'print:border-b-0 print:px-0'
const PRINT_CARD_BODY = 'print:px-0'

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
    <span className={cn('font-semibold print:text-text-strong', INSIGHT_STATUS_TEXT[status], className)}>
      <span aria-hidden="true">{INSIGHT_STATUS_EMOJI[status]}</span> {INSIGHT_STATUS_WORD[status]}
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
      <p className="mb-1 text-sm font-semibold text-text-strong">{title}</p>
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
      <p className="mb-1 text-sm font-semibold text-text-strong">{list.title}</p>
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
  const title = insightSectionTitle(section.title)
  return (
    // The section carries the jump-link anchor and keeps a card whole on one printed page where
    // it can; the Card inside is the panel.
    <section
      id={section.key}
      aria-label={`${title}: ${INSIGHT_STATUS_WORD[section.status]}`}
      className="scroll-mt-4 print:break-inside-avoid-page"
    >
      <Card className={PRINT_CARD}>
        <CardHeader
          title={title}
          action={<StatusLabel status={section.status} />}
          className={PRINT_CARD_HEADER}
        />
        <CardBody className={cn('space-y-3', PRINT_CARD_BODY)}>
          <p className="text-sm text-text">{section.headline}</p>

          {section.metrics.length > 0 && (
            // On a phone the figures scroll inside the card rather than widening the page.
            <Table className="max-w-2xl print:overflow-visible">
              <TableBody>
                {section.metrics.map((metric, index) => (
                  <TableRow key={`${index}-${metric.label}`}>
                    {/* A row header, so each figure is read with its label. TableCell has no th. */}
                    <th scope="row" className="px-4 py-cell-y text-left align-top text-ui font-normal text-text-muted print:text-text-strong">{metric.label}</th>
                    <TableCell className="align-top font-semibold text-text-strong">{metric.value}</TableCell>
                    <TableCell className="min-w-48 whitespace-normal align-top text-text-muted print:text-text-strong">{metric.comparison ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

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

          {sectionPath && (
            <p className="text-sm print:hidden">
              <Link href={sectionPath} className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-hidden focus-visible:shadow-ring">
                Open {section.title.toLowerCase()}
              </Link>
            </p>
          )}
        </CardBody>
      </Card>
    </section>
  )
}

export function InsightsReportView({ report }: { report: InsightsReport }): React.JSX.Element {
  const { windows, summary } = report
  const generated = new Date(report.generatedAt)
  const subtitle = `As of ${formatLondonClock(generated)} on ${formatWeekday(windows.today)} ${formatDateWithYear(windows.today)}`
  const period = `Looks back over ${formatDayDate(windows.thisWeek.start)} to ${formatDayDate(windows.thisWeek.end)} and ahead to ${formatDayDate(windows.next14.end)}.`
  const notChecked = report.sections.filter((section) => section.status === 'not_checked')

  return (
    <PageLayout {...INSIGHTS_LAYOUT} subtitle={subtitle} headerActions={<InsightsToolbar />}>
      {/*
        Kept for print: on paper the blocks sit 12px apart and plain text prints in the strong
        ink. On screen this is the same 24px rhythm PageLayout gives its children.
      */}
      <div className="space-y-6 print:space-y-3 print:text-text-strong">
        <Card className={PRINT_CARD}>
          <CardHeader title="Summary" className={PRINT_CARD_HEADER} />
          <CardBody className={cn('space-y-2', PRINT_CARD_BODY)}>
            <p className="text-sm text-text-muted print:text-text-strong">{period}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {(['red', 'amber', 'green', 'not_checked'] as const).map((status) => (
                <span key={status}>
                  <StatusLabel status={status} /> {summary.counts[status]}
                </span>
              ))}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
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
              <p className="text-sm font-semibold text-danger-fg print:text-text-strong" role="alert">
                Not checked: {notChecked.map((section) => section.title).join(', ')}. The data could not be read. Refresh, or open those sections directly.
              </p>
            )}
          </CardBody>
        </Card>

        <nav aria-label="Report sections" className="print:hidden">
          <ul className="flex flex-wrap gap-2">
            {report.sections.map((section) => (
              <li key={section.key}>
                <LinkButton href={`#${section.key}`} variant="secondary" size="sm">
                  <span aria-hidden="true">{INSIGHT_STATUS_EMOJI[section.status]}</span>
                  <span>{insightSectionTitle(section.title)}</span>
                  <span className="sr-only">: {INSIGHT_STATUS_WORD[section.status]}</span>
                </LinkButton>
              </li>
            ))}
            <li>
              <LinkButton href="#actions" variant="secondary" size="sm">
                Manager Actions
              </LinkButton>
            </li>
          </ul>
        </nav>

        {report.sections.map((section) => <SectionCard key={section.key} section={section} />)}

        <section id="actions" aria-label="Manager actions this week" className="scroll-mt-4 print:break-inside-avoid-page">
          <Card className={PRINT_CARD}>
            <CardHeader title="Manager Actions This Week" className={PRINT_CARD_HEADER} />
            <CardBody className={cn('space-y-2', PRINT_CARD_BODY)}>
              {report.actions.length === 0 ? (
                <p className="text-sm">No actions this week.</p>
              ) : (
                <ol className="list-decimal space-y-2 pl-5 text-sm">
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
                <p className="text-sm">Plus {report.moreRedActions} more to action, shown in their sections above.</p>
              )}
            </CardBody>
          </Card>
        </section>

        <p className="text-xs text-text-muted print:text-text-strong">
          Built from live data when this page was opened. Printed copies contain staff and customer details: shred after the meeting.
        </p>
      </div>
    </PageLayout>
  )
}
