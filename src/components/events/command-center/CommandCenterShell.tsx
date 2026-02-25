'use client'

import React, { useState, useMemo } from 'react'
import type {
    EventsOverviewResult,
    EventOverview,
    CalendarNoteCalendarOverview,
} from '@/app/(authenticated)/events/get-events-command-center'
import ControlBar, { ViewMode, FilterType } from './ControlBar'
import EventCalendarView from './EventCalendarView'
import EventGrid from './EventGrid'
import EventList from './EventList'
import TaskSidebar from './TaskSidebar'
import EventExportPanel from './EventExportPanel'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'

interface CommandCenterShellProps {
    initialData: EventsOverviewResult
    canCreateCalendarNote?: boolean
}

export default function CommandCenterShell({ initialData, canCreateCalendarNote }: CommandCenterShellProps) {
    const [viewMode, setViewMode] = useState<ViewMode>('calendar')
    const [filter, setFilter] = useState<FilterType>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)
    const [isExportModalOpen, setIsExportModalOpen] = useState(false)
    const { hasPermission } = usePermissions()
    const canExport = hasPermission('events', 'export') || hasPermission('events', 'manage')
    const allEvents = useMemo(
        () => [...initialData.past, ...initialData.upcoming],
        [initialData.past, initialData.upcoming]
    )

    // Filter Logic
    const filterEvents = (events: EventOverview[]) => {
        let filtered = events

        // 1. Text Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(e =>
                e.name.toLowerCase().includes(q) ||
                (e.category?.name || '').toLowerCase().includes(q)
            )
        }

        // 2. Status Filters
        if (filter === 'attention_needed') {
            filtered = filtered.filter(e =>
                e.checklist.overdueCount > 0 ||
                e.checklist.dueTodayCount > 0
            )
        }

        return filtered
    }

    const filteredAllEvents = useMemo(() => filterEvents(allEvents), [allEvents, searchQuery, filter])
    const filteredCalendarNotes = useMemo(() => {
        if (!searchQuery.trim()) {
            return initialData.calendarNotes
        }

        const q = searchQuery.toLowerCase()
        return initialData.calendarNotes.filter((note: CalendarNoteCalendarOverview) => (
            note.title.toLowerCase().includes(q) ||
            (note.notes || '').toLowerCase().includes(q) ||
            note.note_date.includes(searchQuery) ||
            note.end_date.includes(searchQuery)
        ))
    }, [initialData.calendarNotes, searchQuery])


    return (
        <>
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 pr-0 md:pr-4 overflow-hidden">
                    <ControlBar
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        filter={filter}
                        setFilter={setFilter}
                        canExport={canExport}
                        onExportClick={() => setIsExportModalOpen(true)}
                    />

                    <div className="flex-1 overflow-y-auto min-h-0 pb-20 scrollbar-hide">
                        {viewMode === 'calendar' ? (
                            <EventCalendarView
                                events={filteredAllEvents}
                                privateBookings={initialData.privateBookingsForCalendar}
                                calendarNotes={filteredCalendarNotes}
                                canCreateCalendarNote={canCreateCalendarNote}
                            />
                        ) : viewMode === 'grid' ? (
                            <EventGrid events={filteredAllEvents} />
                        ) : (
                            <EventList events={filteredAllEvents} />
                        )}
                    </div>
                </div>

                {/* Sidebar (Desktop only for MVP visual structure, responsive handling in component) */}
                <div className={`hidden lg:flex h-full flex-col transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-10'}`}>
                    <div className="flex-1 min-h-0">
                        <TaskSidebar
                            todos={initialData.todos}
                            isOpen={isSidebarOpen}
                            toggle={() => setIsSidebarOpen(!isSidebarOpen)}
                        />
                    </div>
                </div>
            </div>

            {canExport && (
                <Modal
                    open={isExportModalOpen}
                    onClose={() => setIsExportModalOpen(false)}
                    title="Download events"
                    description="Export event briefs, dates, times, statuses, and booking details."
                    size="lg"
                >
                    <EventExportPanel
                        events={allEvents}
                        idPrefix="event-export-modal"
                        onExportSuccess={() => setIsExportModalOpen(false)}
                    />
                </Modal>
            )}
        </>
    )
}
