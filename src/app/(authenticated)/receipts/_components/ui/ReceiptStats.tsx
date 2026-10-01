import { Alert, Stat, StatGrid } from '@/ds'
import type { ReceiptWorkspaceSummary, AIUsageBreakdown } from '@/app/actions/receipts'

function formatCurrencyStrict(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value ?? 0)
}

function formatCount(value: number) {
  return value === 0 ? 'All clear' : value === 1 ? '1 item' : `${value} items`
}

function aiSpendHint(cost: number, breakdown?: AIUsageBreakdown | null) {
  const avgPerTx = breakdown && breakdown.total_classifications > 0
    ? breakdown.total_cost / breakdown.total_classifications
    : null

  if (!breakdown) return cost > 0 ? 'Includes AI tagging' : 'No spend yet'
  if (avgPerTx === null) return `This month ${formatCurrencyStrict(breakdown.this_month_cost)}`
  return `This month ${formatCurrencyStrict(breakdown.this_month_cost)} - ${formatCurrencyStrict(avgPerTx)} avg`
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
        <Stat label="OpenAI spend" value={formatCurrencyStrict(summary.openAICost)} hint={aiSpendHint(summary.openAICost, summary.aiUsageBreakdown)} />
        <Stat label="Pending" value={countValue(summary.totals.pending)} hint={countHint(summary.totals.pending)} />
        <Stat label="Completed" value={countValue(summary.totals.completed)} hint={countHint(summary.totals.completed)} />
        <Stat label="Auto completed" value={countValue(summary.totals.autoCompleted)} hint={countHint(summary.totals.autoCompleted)} />
        <Stat label="No receipt required" value={countValue(summary.totals.noReceiptRequired)} hint={countHint(summary.totals.noReceiptRequired)} />
        <Stat label="Can't find" value={countValue(summary.totals.cantFind)} hint={countHint(summary.totals.cantFind)} />
      </StatGrid>
    </>
  )
}
