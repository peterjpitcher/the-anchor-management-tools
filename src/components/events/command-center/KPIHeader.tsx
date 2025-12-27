import { EventsOverviewResult } from "@/app/(authenticated)/events/get-events-command-center"

interface KPIHeaderProps {
    kpis: EventsOverviewResult['kpis']
}

export default function KPIHeader({ kpis }: KPIHeaderProps) {
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: 'GBP',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount)
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Active Events */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Active Events</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-gray-900">{kpis.activeEvents}</span>
                    <span className="text-xs text-gray-500">next 30d</span>
                </div>
            </div>

            {/* Ticket Velocity */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Ticket Velocity</div>
                <div className="mt-1 flex items-baseline gap-2">
                    {kpis.velocityPercent !== null ? (
                        <>
                            <span className={`text-2xl font-semibold ${kpis.velocityPercent >= 80 ? 'text-green-600' : 'text-gray-900'}`}>
                                {kpis.velocityPercent}%
                            </span>
                            <span className="text-xs text-gray-500">sold (24h)</span>
                        </>
                    ) : (
                        <>
                            <span className="text-2xl font-semibold text-gray-900">{kpis.last24hSeats}</span>
                            <span className="text-xs text-gray-500">seats (24h)</span>
                        </>
                    )}
                </div>
            </div>

            {/* Urgent Attention */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Urgent Attention</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-semibold ${kpis.urgentAttention > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {kpis.urgentAttention}
                    </span>
                    <span className="text-xs text-gray-500">tasks/alerts</span>
                </div>
            </div>

            {/* Revenue Estimate */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Revenue (Est.)</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-gray-900">{formatCurrency(kpis.revenueEstimate)}</span>
                    <span className="text-xs text-gray-500">next 30d</span>
                </div>
            </div>
        </div>
    )
}
