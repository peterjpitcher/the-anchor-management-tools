'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { EventOverview } from '@/app/(authenticated)/events/get-events-command-center'
// Assuming these exist or we use standard HTML/Tailwind
import { format } from 'date-fns'
import { TrashIcon } from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteEvent } from '@/app/actions/events'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface EventCardProps {
    event: EventOverview
}

export default function EventCard({ event }: EventCardProps) {
    const router = useRouter()
    const { hasPermission } = usePermissions()
    const canManageEvents = hasPermission('events', 'manage')
    const [isDeleting, setIsDeleting] = useState(false)
    // Helpers
    const formatTime = (timeStr: string) => {
        // Basic parse assuming HH:mm:ss or HH:mm
        const [h, m] = timeStr.split(':')
        return `${h}:${m}`
    }

    const getProgressColor = (percent: number) => {
        if (percent >= 100) return 'bg-purple-600'
        if (percent >= 80) return 'bg-green-500'
        return 'bg-blue-500'
    }

    const capacityPercent = event.capacity ? Math.min(100, Math.round((event.bookedSeats / event.capacity) * 100)) : 0
    const checklistPercent = Math.round((event.checklist.completed / event.checklist.total) * 100)

    // Determine gradient based on category color or default
    const fallbackGradient = event.category?.color
        ? { backgroundColor: event.category.color }
        : { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }

    const handleCardClick = () => {
        router.push(`/events/${event.id}`)
    }

    const handleDeleteEvent = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault()
        e.stopPropagation()

        if (!canManageEvents) {
            toast.error('You do not have permission to delete events.')
            return
        }

        if (!window.confirm(`Delete "${event.name}"? This action cannot be undone.`)) return

        try {
            setIsDeleting(true)
            const result = await deleteEvent(event.id)
            if (result && 'error' in result && result.error) {
                toast.error(result.error)
                return
            }

            toast.success('Event deleted successfully')
            router.refresh()
        } catch (error) {
            console.error('Error deleting event:', error)
            toast.error(error instanceof Error ? error.message : 'Failed to delete event')
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div
            onClick={handleCardClick}
            className="group relative bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col h-full cursor-pointer"
        >
            {/* Hero Image Section */}
            <div className="relative aspect-square w-full bg-gray-100 overflow-hidden">
                {event.heroImageUrl ? (
                    <Image
                        src={event.heroImageUrl}
                        alt={event.name}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                ) : (
                    <div className="w-full h-full" style={fallbackGradient} />
                )}

                {canManageEvents && (
                    <div className="absolute top-2 left-2">
                        <button
                            type="button"
                            onClick={handleDeleteEvent}
                            disabled={isDeleting}
                            className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white/90 p-1.5 text-red-600 shadow-sm hover:bg-white hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Delete event"
                        >
                            <TrashIcon className="h-4 w-4" />
                            <span className="sr-only">Delete Event</span>
                        </button>
                    </div>
                )}

                {/* Status Badge Overlay */}
                <div className="absolute top-2 right-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border shadow-sm
            ${event.statusBadge.tone === 'success' ? 'bg-green-100 text-green-800 border-green-200' :
                            event.statusBadge.tone === 'warning' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                                event.statusBadge.tone === 'error' ? 'bg-red-100 text-red-800 border-red-200' :
                                    'bg-gray-100 text-gray-800 border-gray-200'}`
                    }>
                        {event.statusBadge.label}
                    </span>
                </div>
            </div>

            {/* Content Section */}
            <div className="p-4 flex-1 flex flex-col">
                {/* Date & Title */}
                <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {event.daysUntil === 0 ? 'Today' :
                            event.daysUntil === 1 ? 'Tomorrow' :
                                format(new Date(event.date), 'EEE d MMM')} • {formatTime(event.time)}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 leading-tight truncate" title={event.name}>
                        {event.name}
                    </h3>
                </div>

                {/* Capacity Bar */}
                <div className="mt-auto pt-4 space-y-2">
                    {event.capacity ? (
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-600 font-medium">{event.bookedSeats} / {event.capacity} seats</span>
                                <span className="text-gray-500">{capacityPercent}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${getProgressColor(capacityPercent)}`}
                                    style={{ width: `${capacityPercent}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-between text-xs py-2 border-t border-gray-100">
                            <span className="text-gray-600 font-medium">Unlimited Capacity</span>
                            <span className="text-gray-900 font-bold">{event.bookedSeats} booked</span>
                        </div>
                    )}
                </div>

                {/* Checklist Ring & Quick Stats */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {/* Simple Ring Implementation with SVG */}
                        <div className="relative w-8 h-8">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                <path className="text-gray-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                <path
                                    className={`${checklistPercent === 100 ? 'text-green-500' : event.checklist.overdueCount > 0 ? 'text-red-500' : 'text-blue-500'}`}
                                    strokeDasharray={`${checklistPercent}, 100`}
                                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">
                                {checklistPercent}%
                            </div>
                        </div>
                        <div className="text-xs text-gray-500 flex flex-col">
                            <span>{event.checklist.completed}/{event.checklist.total} Tasks</span>
                            {event.checklist.overdueCount > 0 && <span className="text-red-600 font-medium">{event.checklist.overdueCount} Overdue</span>}
                        </div>
                    </div>
                </div>
            </div>


        </div>
    )
}
