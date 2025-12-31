'use client'

import React from 'react'
import type { HiringApplicationStage } from '@/types/database'
import type { HiringJobSummary } from '@/types/hiring'
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable'
import { StatusIndicator } from '@/components/ui-v2/display/StatusIndicator'
import { Badge } from '@/components/ui-v2/display/Badge'
import { format } from 'date-fns'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'

interface JobsTableProps {
    jobs: HiringJobSummary[]
}

export function JobsTable({ jobs }: JobsTableProps) {
    const router = useRouter()
    const columns: Column<HiringJobSummary>[] = [
        {
            key: 'title',
            header: 'Job Title',
            cell: (job) => (
                <div className="flex flex-col">
                    <span className="font-medium text-gray-900">{job.title}</span>
                    <span className="text-xs text-gray-500">{job.location}</span>
                </div>
            ),
            sortable: true,
            sortFn: (a, b) => a.title.localeCompare(b.title),
        },
        {
            key: 'status',
            header: 'Status',
            cell: (job) => {
                let statusType: 'success' | 'warning' | 'offline' = 'offline'
                switch (job.status) {
                    case 'open': statusType = 'success'; break;
                    case 'draft': statusType = 'warning'; break;
                    case 'closed': statusType = 'offline'; break;
                    case 'expired': statusType = 'warning'; break;
                    case 'archived': statusType = 'offline'; break;
                }

                return (
                    <StatusIndicator
                        status={statusType}
                        variant="badge"
                        label={job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        size="sm"
                    />
                )
            },
            sortable: true,
        },
        {
            key: 'applicants',
            header: 'Candidates',
            cell: (job) => (
                <div className="text-sm text-gray-500">
                    {job.applicantCount}
                </div>
            ),
        },
        {
            key: 'stages',
            header: 'Stage Counts',
            cell: (job) => {
                const visibleStages: HiringApplicationStage[] = [
                    'new',
                    'screening',
                    'screened',
                    'in_conversation',
                    'interview_scheduled',
                    'interviewed',
                    'offer',
                    'hired',
                    'rejected',
                    'withdrawn',
                ]

                return (
                    <div className="flex flex-wrap gap-2">
                        {visibleStages.map((stage) => {
                            const count = job.stageCounts?.[stage] ?? 0
                            if (!count) return null
                            const variant =
                                stage === 'new' ? 'info'
                                    : stage === 'screening' ? 'warning'
                                        : stage === 'screened' ? 'info'
                                            : stage === 'in_conversation' ? 'primary'
                                                : stage === 'interview_scheduled' ? 'warning'
                                                    : stage === 'interviewed' ? 'info'
                                                        : stage === 'offer' ? 'success'
                                                            : stage === 'hired' ? 'success'
                                                                : stage === 'rejected' ? 'error'
                                                                    : stage === 'withdrawn' ? 'default'
                                                                        : 'default'
                            const label = stage.replace('_', ' ')
                            return (
                                <Badge key={stage} variant={variant} size="sm">
                                    {label}: {count}
                                </Badge>
                            )
                        })}
                        {job.overdueCount > 0 && (
                            <Badge variant="error" size="sm">
                                Overdue: {job.overdueCount}
                            </Badge>
                        )}
                        {job.applicantCount === 0 && (
                            <span className="text-xs text-gray-400">No applications yet</span>
                        )}
                    </div>
                )
            },
        },
        {
            key: 'posted_date',
            header: 'Posted',
            cell: (job) => {
                const postedAt = job.posting_date || job.created_at
                return (
                    <span className="text-sm text-gray-500">
                        {postedAt ? format(new Date(postedAt), 'MMM d, yyyy') : '-'}
                    </span>
                )
            },
            sortable: true,
            sortFn: (a, b) => {
                const dateA = a.posting_date || a.created_at
                const dateB = b.posting_date || b.created_at
                const timeA = dateA ? new Date(dateA).getTime() : 0
                const timeB = dateB ? new Date(dateB).getTime() : 0
                return timeA - timeB
            }
        },
        {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (job) => (
                <button
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/hiring/${job.id}/edit`)
                    }}
                >
                    <PencilSquareIcon className="h-5 w-5" />
                </button>
            ),
            width: '50px'
        }
    ]

    return (
        <DataTable
            data={jobs}
            columns={columns}
            getRowKey={(job) => job.id}
            clickableRows
            onRowClick={(job) => router.push(`/hiring/${job.id}`)}
            emptyMessage="No jobs found"
            emptyDescription="Create a new job posting to get started"
        />
    )
}
