'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

interface CheckInShellProps {
    title: string
    subtitle?: string
    backHref: string
    children: ReactNode
    headerActions?: ReactNode
}

export function CheckInShell({
    title,
    subtitle,
    backHref,
    children,
    headerActions
}: CheckInShellProps) {
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Focused Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 safe-area-inset-top">
                <div className="px-4 h-16 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <Link
                            href={backHref}
                            className="p-2 -ml-2 rounded-full text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                            title="Exit Check-in"
                        >
                            <ArrowLeftIcon className="h-6 w-6" />
                        </Link>
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-gray-900 truncate leading-tight">
                                {title}
                            </h1>
                            {subtitle && (
                                <p className="text-xs text-gray-500 truncate font-medium">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        {headerActions}
                    </div>
                </div>
            </header>

            {/* Main Content Area - Maximized for list view */}
            <main className="flex-1 relative">
                {children}
            </main>
        </div>
    )
}
