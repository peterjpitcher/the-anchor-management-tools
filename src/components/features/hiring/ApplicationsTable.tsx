'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { HiringApplication } from '@/types/database'
import type { HiringApplicationWithCandidateSummary } from '@/types/hiring'
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable'
import { StatusIndicator } from '@/components/ui-v2/display/StatusIndicator'
import { Badge } from '@/components/ui-v2/display/Badge'
import { format } from 'date-fns'
import { ChevronRightIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline'

interface ApplicationsTableProps {
    applications: HiringApplicationWithCandidateSummary[]
}

export function ApplicationsTable({ applications }: ApplicationsTableProps) {
    const router = useRouter()

    const formatStageLabel = (stage: HiringApplication['stage']) => {
        const labels: Record<HiringApplication['stage'], string> = {
            new: 'New',
            screening: 'Screening',
            screened: 'Screened',
            in_conversation: 'In conversation',
            interview_scheduled: 'Interview scheduled',
            interviewed: 'Interviewed',
            offer: 'Offer',
            hired: 'Hired',
            rejected: 'Rejected',
            withdrawn: 'Withdrawn',
        }
        return labels[stage] || stage.replace(/_/g, ' ')
    }

    const columns: Column<HiringApplicationWithCandidateSummary>[] = [
        {
            key: 'candidate',
            header: 'Candidate',
            cell: (app) => (
                <div className="flex flex-col">
                    <span className="font-medium text-gray-900">
                        {app.candidate.first_name} {app.candidate.last_name}
                    </span>
                    <span className="text-xs text-gray-500">{app.candidate.email}</span>
                    {app.candidate_application_count && app.candidate_application_count > 1 && (
                        <span className="text-xs text-gray-400">
                            Applied {app.candidate_application_count} times
                            {app.candidate_last_applied_at
                                ? ` (last ${format(new Date(app.candidate_last_applied_at), 'MMM d, yyyy')})`
                                : ''}
                        </span>
                    )}
                </div>
            ),
            sortable: true,
            sortFn: (a, b) =>
                (a.candidate.first_name + a.candidate.last_name).localeCompare(b.candidate.first_name + b.candidate.last_name),
        },
        {
            key: 'stage',
            header: 'Stage',
            cell: (app) => {
                let statusType: 'online' | 'offline' | 'warning' | 'error' | 'success' | 'busy' | 'loading' | 'away' = 'online'
                switch (app.stage) {
                    case 'new': statusType = 'warning'; break;
                    case 'screening': statusType = 'loading'; break;
                    case 'screened': statusType = 'success'; break;
                    case 'in_conversation': statusType = 'away'; break;
                    case 'interview_scheduled': statusType = 'warning'; break;
                    case 'interviewed': statusType = 'busy'; break;
                    case 'offer': statusType = 'success'; break;
                    case 'hired': statusType = 'success'; break;
                    case 'rejected': statusType = 'error'; break;
                    case 'withdrawn': statusType = 'offline'; break;
                }
                return (
                    <StatusIndicator
                        status={statusType}
                        variant="badge"
                        label={formatStageLabel(app.stage)}
                        size="sm"
                    />
                )
            },
            sortable: true,
        },
        {
            key: 'score',
            header: 'Score',
            cell: (app) => (
                <span className="text-sm text-gray-500">
                    {app.ai_score != null ? `${app.ai_score}/10` : '-'}
                </span>
            ),
            sortable: true,
            sortFn: (a, b) => (a.ai_score ?? -1) - (b.ai_score ?? -1)
        },
        {
            key: 'recommendation',
            header: 'Recommendation',
            cell: (app) => {
                const value = app.ai_recommendation
                if (!value) return <span className="text-xs text-gray-400">Pending</span>
                const variant = value === 'invite'
                    ? 'success'
                    : value === 'clarify'
                        ? 'warning'
                        : value === 'hold'
                            ? 'info'
                            : value === 'reject'
                                ? 'error'
                                : 'default'
                return (
                    <Badge variant={variant} size="sm">
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                    </Badge>
                )
            },
            sortable: true,
            sortFn: (a, b) => (a.ai_recommendation || '').localeCompare(b.ai_recommendation || ''),
        },
        {
            key: 'applied',
            header: 'Applied',
            cell: (app) => (
                <span className="text-sm text-gray-500">
                    {format(new Date(app.created_at), 'MMM d, yyyy')}
                </span>
            ),
            sortable: true,
            sortFn: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        },
        {
            key: 'resume',
            header: 'CV',
            align: 'right',
            cell: (app) => app.candidate.resume_url ? (
                <a
                    href={app.candidate.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-600 transition-colors inline-block"
                    onClick={(e) => e.stopPropagation()}
                >
                    <DocumentArrowDownIcon className="h-5 w-5" />
                </a>
            ) : null,
            width: '50px'
        },
        {
            key: 'actions',
            header: '',
            align: 'right',
            cell: () => <ChevronRightIcon className="h-4 w-4 text-gray-400" />,
            width: '40px'
        }
    ]

    return (
        <DataTable
            data={applications}
            columns={columns}
            getRowKey={(app) => app.id}
            clickableRows
            onRowClick={(app) => router.push(`/hiring/applications/${app.id}`)}
            emptyMessage="No applications yet"
            emptyDescription="Candidates who apply will appear here."
            mobileBreakpoint={640} // collapse earlier on smaller screens if needed
        />
    )
}
