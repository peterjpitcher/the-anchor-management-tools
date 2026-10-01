import { Alert, Stat, StatGrid } from '@/ds'
import type { ReceiptWorkspaceSummary, AIUsageBreakdown } from '@/app/actions/receipts'

/** OpenAI charges in US dollars, and the figure is stored as charged. It is not pounds. */
function formatUsd(value: number) {
  const amount = value ?? 0
  // Under a cent the tile would read "US$0.00" for a month that did cost something.
  const digits = amount > 0 && amount < 0.01 ? 4 : 2
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)
}

function formatCount(value: number) {
  return value === 0 ? 'All clear' : value === 1 ? '1 item' : `${value} items`
}

function aiSpendHint(breakdown?: AIUsageBreakdown | null) {
  if (!breakdown) return 'Could not load'
  if (breakdown.total_calls === 0) return 'No spend yet'
  return `This month ${formatUsd(breakdown.this_month_cost)}, receipts only`
}

interface ReceiptStatsProps {
  summary: ReceiptWorkspaceSummary
}

/** A fragment: the alert and the figures are separate blocks in the page's 24px stack. */
export function ReceiptStats({ summary }: ReceiptStatsProps) {
  // When the counts could not be read they are unknown. Showing 0 and "All clear" would say
  // there is nothing to do, which is the one thing we do not know.
  const unknown = Boolean(summary.totalsUnavailable)
  const countValue = (value: number) => (unknown ? '?' : value)
  const countHint = (value: number) => (unknown ? 'Could not load' : formatCount(value))

  return (
    <>
      {unknown && (
        <Alert tone="danger" title="The transaction counts could not be loaded">
          The figures below are not known, not zero. Refresh the page to try again.
        </Alert>
      )}
      {summary.failedAiJobCount > 0 && (
        <Alert tone="warning" title={`${summary.failedAiJobCount} AI classification job${summary.failedAiJobCount !== 1 ? 's' : ''} failed`}>
          These could not be retried automatically. Use Re-classify Untagged at the top of the page to try them again.
        </Alert>
      )}
      <StatGrid columns={6}>
        <Stat label="AI spend (US dollars)" value={summary.aiUsageBreakdown ? formatUsd(summary.openAICost) : '?'} hint={aiSpendHint(summary.aiUsageBreakdown)} />
        <Stat label="Pending" value={countValue(summary.totals.pending)} hint={countHint(summary.totals.pending)} />
        <Stat label="Completed" value={countValue(summary.totals.completed)} hint={countHint(summary.totals.completed)} />
        <Stat label="Auto completed" value={countValue(summary.totals.autoCompleted)} hint={countHint(summary.totals.autoCompleted)} />
        <Stat label="No receipt required" value={countValue(summary.totals.noReceiptRequired)} hint={countHint(summary.totals.noReceiptRequired)} />
        <Stat label="Can't find" value={countValue(summary.totals.cantFind)} hint={countHint(summary.totals.cantFind)} />
      </StatGrid>
    </>
  )
}
