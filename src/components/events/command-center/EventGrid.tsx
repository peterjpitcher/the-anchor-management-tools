import React from 'react'
import { EventOverview } from '@/app/(authenticated)/events/get-events-command-center'
import EventCard from './EventCard'

interface EventGridProps {
    events: EventOverview[]
}

export default function EventGrid({ events }: EventGridProps) {
    if (events.length === 0) {
        return (
            <div className="text-center py-20 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <p className="text-gray-500">No events found matching your criteria.</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
            {events.map((event) => (
                <div key={event.id} className="h-full">
                    <EventCard event={event} />
                </div>
            ))}
        </div>
    )
}
