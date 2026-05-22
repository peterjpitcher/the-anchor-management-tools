import { Alert, Stat } from '@/ds'
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

export function ReceiptStats({ summary }: ReceiptStatsProps) {
  return (
    <div className="space-y-3">
      {summary.failedAiJobCount > 0 && (
        <Alert tone="warning" title={`${summary.failedAiJobCount} AI classification job${summary.failedAiJobCount !== 1 ? 's' : ''} failed`}>
          These could not be retried automatically. Use the re-queue button to retry classification.
        </Alert>
      )}
      <div className="hidden md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-6">
        <Stat label="OpenAI spend" value={formatCurrencyStrict(summary.openAICost)} hint={aiSpendHint(summary.openAICost, summary.aiUsageBreakdown)} />
        <Stat label="Pending" value={summary.totals.pending} hint={formatCount(summary.totals.pending)} />
        <Stat label="Completed" value={summary.totals.completed} hint={formatCount(summary.totals.completed)} />
        <Stat label="Auto completed" value={summary.totals.autoCompleted} hint={formatCount(summary.totals.autoCompleted)} />
        <Stat label="No receipt required" value={summary.totals.noReceiptRequired} hint={formatCount(summary.totals.noReceiptRequired)} />
        <Stat label="Can't find" value={summary.totals.cantFind} hint={formatCount(summary.totals.cantFind)} />
      </div>
    </div>
  )
}
