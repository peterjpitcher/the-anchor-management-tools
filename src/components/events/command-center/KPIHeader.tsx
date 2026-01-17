import { EventsOverviewResult } from "@/app/(authenticated)/events/get-events-command-center"

interface KPIHeaderProps {
    kpis: EventsOverviewResult['kpis']
}

export default function KPIHeader({ kpis }: KPIHeaderProps) {
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

            {/* Overdue Tasks */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Overdue Tasks</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-semibold ${kpis.overdueTasks > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {kpis.overdueTasks}
                    </span>
                    <span className="text-xs text-gray-500">due</span>
                </div>
            </div>

            {/* Due Today */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Due Today</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-semibold ${kpis.dueTodayTasks > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                        {kpis.dueTodayTasks}
                    </span>
                    <span className="text-xs text-gray-500">tasks</span>
                </div>
            </div>

            {/* Draft Events */}
            <div className="bg-white rounded-lg border p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-500">Draft Events</div>
                <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-semibold ${kpis.draftEvents > 0 ? 'text-gray-900' : 'text-gray-900'}`}>
                        {kpis.draftEvents}
                    </span>
                    <span className="text-xs text-gray-500">upcoming</span>
                </div>
            </div>
        </div>
    )
}
