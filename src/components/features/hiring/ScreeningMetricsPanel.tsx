import { Badge } from '@/components/ui-v2/display/Badge'
import type { HiringScreeningMetrics } from '@/types/hiring'

interface ScreeningMetricsPanelProps {
  metrics: HiringScreeningMetrics
}

export function ScreeningMetricsPanel({ metrics }: ScreeningMetricsPanelProps) {
  const failureRateLabel = `${Math.round(metrics.failureRate * 100)}%`
  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Screening Health</h3>
        <p className="text-sm text-gray-500">Metrics since {new Date(metrics.since).toLocaleDateString()}.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-sm text-gray-500">Total runs</div>
          <div className="text-xl font-semibold text-gray-900">{metrics.totalRuns}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Success</div>
          <div className="text-xl font-semibold text-gray-900">{metrics.successRuns}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Failed</div>
          <div className="text-xl font-semibold text-gray-900">{metrics.failedRuns}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Failure rate</div>
          <div className="text-xl font-semibold text-gray-900">{failureRateLabel}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <div className="text-sm text-gray-500">Avg latency</div>
          <div className="text-xl font-semibold text-gray-900">
            {metrics.avgLatencySeconds != null ? `${metrics.avgLatencySeconds}s` : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Last 24h runs</div>
          <div className="text-xl font-semibold text-gray-900">{metrics.last24hRuns}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Last 24h failures</div>
          <div className="text-xl font-semibold text-gray-900">{metrics.last24hFailures}</div>
        </div>
      </div>
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Run types</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(metrics.runTypeBreakdown).map(([key, value]) => (
            <Badge key={key} variant="secondary">
              {key}: {value}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}
