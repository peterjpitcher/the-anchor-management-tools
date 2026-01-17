'use client'

import React, { useState, useMemo } from 'react'
import { EventsOverviewResult } from '@/app/(authenticated)/events/get-events-command-center'
import ControlBar, { ViewMode, FilterType } from './ControlBar'
import EventCalendarView from './EventCalendarView'
import EventGrid from './EventGrid'
import EventList from './EventList'
import TaskSidebar from './TaskSidebar'

interface CommandCenterShellProps {
    initialData: EventsOverviewResult
}

export default function CommandCenterShell({ initialData }: CommandCenterShellProps) {
    const [viewMode, setViewMode] = useState<ViewMode>('calendar')
    const [filter, setFilter] = useState<FilterType>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)

    // Filter Logic
    const filteredEvents = useMemo(() => {
        let events = initialData.upcoming

        // 1. Text Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            events = events.filter(e =>
                e.name.toLowerCase().includes(q) ||
                (e.category?.name || '').toLowerCase().includes(q)
            )
        }

        // 2. Status Filters
        if (filter === 'attention_needed') {
            events = events.filter(e =>
                e.checklist.overdueCount > 0 ||
                e.checklist.dueTodayCount > 0
            )
        }

        return events
    }, [initialData.upcoming, searchQuery, filter])


    return (
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
                />

                <div className="flex-1 overflow-y-auto min-h-0 pb-20 scrollbar-hide">
                    {viewMode === 'calendar' ? (
                        <EventCalendarView events={filteredEvents} />
                    ) : viewMode === 'grid' ? (
                        <EventGrid events={filteredEvents} />
                    ) : (
                        <EventList events={filteredEvents} />
                    )}
                </div>
            </div>

            {/* Sidebar (Desktop only for MVP visual structure, responsive handling in component) */}
            <div className={`hidden lg:block h-full transition-all duration-300 ${isSidebarOpen ? 'w-80' : 'w-10'}`}>
                <TaskSidebar
                    todos={initialData.todos}
                    isOpen={isSidebarOpen}
                    toggle={() => setIsSidebarOpen(!isSidebarOpen)}
                />
            </div>
        </div>
    )
}
