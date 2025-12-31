
'use client'

import React from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { formatDate } from '@/lib/utils'
import type { HiringApplication, HiringCandidate, HiringJob } from '@/types/database'
import { EyeIcon } from '@heroicons/react/24/outline'

type ExtendedCandidate = HiringCandidate & {
    applications: (HiringApplication & { job: HiringJob })[]
}

interface CandidateListProps {
    candidates: ExtendedCandidate[]
}

const statusColors: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
    new: 'info',
    screening: 'warning',
    screened: 'primary',
    in_conversation: 'info',
    interview_scheduled: 'warning',
    interviewed: 'warning',
    offer: 'success',
    hired: 'success',
    rejected: 'error',
    withdrawn: 'default',
}

export function CandidateList({ candidates }: CandidateListProps) {
    if (candidates.length === 0) {
        return (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <p className="text-gray-500 dark:text-gray-400">No candidates found.</p>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow ring-1 ring-black ring-opacity-5 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                        <tr>
                            <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">Candidate</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Role(s)</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Latest Status</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Added</th>
                            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                        {candidates.map((candidate) => {
                            const latestApp = candidate.applications?.[0]
                            const roles = candidate.applications?.map(app => app.job.title).join(', ') || 'Unassigned'
                            const isProcessing = candidate.first_name === 'Parsing' && candidate.last_name === 'CV...'
                            const applicationCount = candidate.applications?.length || 0
                            const lastAppliedAt = candidate.applications
                                ?.map((app) => app.created_at)
                                .filter(Boolean)
                                .sort()
                                .pop()

                            return (
                                <tr key={candidate.id}>
                                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-white sm:pl-6">
                                        {isProcessing ? (
                                            <div className="flex items-center gap-2 text-gray-500 italic">
                                                <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Processing CV...
                                            </div>
                                        ) : (
                                            <Link href={`/hiring/candidates/${candidate.id}`} className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline">
                                                {candidate.first_name} {candidate.last_name}
                                            </Link>
                                        )}
                                        <div className="text-gray-500 font-normal">{candidate.email}</div>
                                        {applicationCount > 1 && lastAppliedAt && (
                                            <div className="text-xs text-gray-400">
                                                Applied {applicationCount} times (last {formatDate(lastAppliedAt)})
                                            </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300">
                                        {roles}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                                        {latestApp ? (
                                            <Badge variant={statusColors[latestApp.stage] || 'default'}>
                                                {latestApp.stage.replace('_', ' ')}
                                            </Badge>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300">
                                        {formatDate(candidate.created_at)}
                                    </td>
                                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6 text-gray-500 dark:text-gray-400">
                                        {latestApp ? (
                                            <Link href={`/hiring/applications/${latestApp.id}`}>
                                                <Button variant="ghost" size="sm" leftIcon={<EyeIcon className="w-4 h-4" />}>
                                                    View
                                                </Button>
                                            </Link>
                                        ) : (
                                            <span className="text-xs">No App</span>
                                            // Future: Link to Candidate Profile View?
                                            // For now, only applications have detailed views.
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
