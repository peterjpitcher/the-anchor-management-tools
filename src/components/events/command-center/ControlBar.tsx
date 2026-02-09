'use client'

import React from 'react'
import {
    ArrowDownTrayIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    ViewColumnsIcon,
    ListBulletIcon,
    CalendarDaysIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'

export type ViewMode = 'calendar' | 'grid' | 'list'
export type FilterType = 'all' | 'attention_needed'

interface ControlBarProps {
    searchQuery: string
    setSearchQuery: (q: string) => void
    viewMode: ViewMode
    setViewMode: (m: ViewMode) => void
    filter: FilterType
    setFilter: (f: FilterType) => void
    canExport?: boolean
    onExportClick?: () => void
}

export default function ControlBar({
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    filter,
    setFilter,
    canExport = false,
    onExportClick
}: ControlBarProps) {
    return (
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 bg-white p-3 rounded-lg border border-gray-200">
            {/* Search and Filters Group */}
            <div className="flex flex-1 items-center gap-4 w-full md:w-auto">
                {/* Search */}
                <div className="relative flex-1 md:max-w-xs">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search events..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 pr-4 py-2 w-full text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-shadow"
                    />
                </div>

                {/* Filters */}
                <div className="hidden md:flex bg-gray-100 p-1 rounded-md">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-all ${filter === 'all' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        All
                    </button>
                    <button
                        onClick={() => setFilter('attention_needed')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-all ${filter === 'attention_needed' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        Attention Needed
                    </button>
                </div>
            </div>

            {/* Actions Group */}
            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                {canExport && onExportClick && (
                    <button
                        type="button"
                        onClick={onExportClick}
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">Download</span>
                    </button>
                )}

                {/* View Toggle */}
                <div className="flex bg-gray-100 p-1 rounded-md">
                    <button
                        onClick={() => setViewMode('calendar')}
                        title="Calendar View"
                        className={`p-1.5 rounded-sm transition-all ${viewMode === 'calendar' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        <CalendarDaysIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        title="Grid View"
                        className={`p-1.5 rounded-sm transition-all ${viewMode === 'grid' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        <ViewColumnsIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        title="List View"
                        className={`p-1.5 rounded-sm transition-all ${viewMode === 'list' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        <ListBulletIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Primary Action */}
                <Link
                    href="/events/new"
                    className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                    <PlusIcon className="w-4 h-4" />
                    <span>New Event</span>
                </Link>
            </div>

            {/* Mobile Filters (visible only on small screens) */}
            <div className="flex md:hidden w-full overflow-x-auto gap-2 pb-1">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap ${filter === 'all' ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200'}`}
                >
                    All Events
                </button>
                <button
                    onClick={() => setFilter('attention_needed')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap ${filter === 'attention_needed' ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200'}`}
                >
                    Attention Needed
                </button>
            </div>
        </div>
    )
}
