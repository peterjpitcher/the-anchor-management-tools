import { Card } from '@/components/ui-v2/layout/Card'
import type { ReceiptWorkspaceSummary, AIUsageBreakdown } from '@/app/actions/receipts'

interface SummaryCardProps {
  title: string
  value: number
  tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger'
}

function SummaryCard({ title, value, tone }: SummaryCardProps) {
  const toneClasses: Record<SummaryCardProps['tone'], string> = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    info: 'bg-blue-50 text-blue-700',
    neutral: 'bg-gray-50 text-gray-700',
    danger: 'bg-rose-50 text-rose-700',
  }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-2">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-3xl font-semibold text-gray-900">{value}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${toneClasses[tone]}`}>
          {value === 0 ? 'All clear' : value === 1 ? '1 item' : `${value} items`}
        </span>
      </div>
    </Card>
  )
}

function formatCurrencyStrict(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value ?? 0)
}

function CostSummaryCard({ cost, breakdown }: { cost: number; breakdown?: AIUsageBreakdown | null }) {
  const badge = cost > 0
    ? { label: 'Includes AI tagging', className: 'bg-blue-50 text-blue-700' }
    : { label: 'No spend yet', className: 'bg-gray-100 text-gray-600' }

  const avgPerTx = breakdown && breakdown.total_classifications > 0
    ? breakdown.total_cost / breakdown.total_classifications
    : null

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-2">
        <p className="text-sm text-gray-500">OpenAI spend</p>
        <p className="text-3xl font-semibold text-gray-900">{formatCurrencyStrict(cost)}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
        {breakdown && (
          <div className="mt-2 space-y-1 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>This month</span>
              <span className="font-medium text-gray-700">{formatCurrencyStrict(breakdown.this_month_cost)}</span>
            </div>
            {avgPerTx != null && (
              <div className="flex justify-between">
                <span>Avg per classification</span>
                <span className="font-medium text-gray-700">{formatCurrencyStrict(avgPerTx)}</span>
              </div>
            )}
            {breakdown.model_breakdown && breakdown.model_breakdown.length > 0 && (
              <div className="pt-1 border-t border-gray-100">
                {breakdown.model_breakdown.map((m) => (
                  <div key={m.model} className="flex justify-between">
                    <span className="truncate max-w-[120px]" title={m.model}>{m.model}</span>
                    <span className="font-medium text-gray-700">{formatCurrencyStrict(m.total_cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

interface ReceiptStatsProps {
  summary: ReceiptWorkspaceSummary
}

export function ReceiptStats({ summary }: ReceiptStatsProps) {
  return (
    <div className="hidden md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-6">
      <CostSummaryCard cost={summary.openAICost} breakdown={summary.aiUsageBreakdown} />
      <SummaryCard title="Pending" value={summary.totals.pending} tone="warning" />
      <SummaryCard title="Completed" value={summary.totals.completed} tone="success" />
      <SummaryCard title="Auto-matched" value={summary.totals.autoCompleted} tone="info" />
      <SummaryCard title="No receipt required" value={summary.totals.noReceiptRequired} tone="neutral" />
      <SummaryCard title="Can't find" value={summary.totals.cantFind} tone="neutral" />
    </div>
  )
}
