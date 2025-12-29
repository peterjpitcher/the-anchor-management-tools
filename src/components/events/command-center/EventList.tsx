import React from 'react'
import { EventOverview } from '@/app/(authenticated)/events/get-events-command-center'
import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui-v2/display/Badge'

interface EventListProps {
    events: EventOverview[]
}

export default function EventList({ events }: EventListProps) {
    if (events.length === 0) {
        return (
            <div className="text-center py-20 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <p className="text-gray-500">No events found matching your criteria.</p>
            </div>
        )
    }

    return (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 bg-white">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capacity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Checklist</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {events.map((event) => (
                        <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {format(new Date(event.date), 'EEE d MMM')} <br />
                                <span className="text-xs text-gray-400">{event.time}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">
                                    <Link href={`/events/${event.id}`} className="hover:text-indigo-600">
                                        {event.name}
                                    </Link>
                                </div>
                                {event.category && (
                                    <div className="mt-1">
                                        <Badge
                                            size="sm"
                                            style={{
                                                backgroundColor: `${event.category.color}20`,
                                                color: event.category.color
                                            }}
                                        >
                                            {event.category.name}
                                        </Badge>
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {event.capacity ? (
                                    <span>
                                        <span className="font-medium text-gray-900">{event.bookedSeats}</span> / {event.capacity}
                                    </span>
                                ) : (
                                    <span>{event.bookedSeats} booked (Unl.)</span>
                                )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                    ${event.statusBadge.tone === 'success' ? 'bg-green-100 text-green-800' :
                                        event.statusBadge.tone === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                                            event.statusBadge.tone === 'error' ? 'bg-red-100 text-red-800' :
                                                'bg-gray-100 text-gray-800'}`
                                }>
                                    {event.statusBadge.label}
                                </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                <div className="flex items-center gap-2">
                                    <span>{Math.round((event.checklist.completed / event.checklist.total) * 100)}%</span>
                                    {event.checklist.overdueCount > 0 && (
                                        <span className="text-xs text-red-600 font-medium">({event.checklist.overdueCount} overdue)</span>
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <Link href={`/events/${event.id}`} className="text-indigo-600 hover:text-indigo-900">
                                    Manage
                                </Link>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
