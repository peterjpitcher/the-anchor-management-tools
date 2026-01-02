
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Button } from '@/components/ui-v2/forms/Button'
import { PlusIcon, UserPlusIcon } from '@heroicons/react/20/solid'
import { JobsTable } from '@/components/features/hiring/JobsTable'
import { CandidateList } from '@/components/features/hiring/CandidateList'
import { AddCandidateModal } from '@/components/features/hiring/AddCandidateModal'
import { DuplicateReviewPanel } from '@/components/features/hiring/DuplicateReviewPanel'
import { ScreeningMetricsPanel } from '@/components/features/hiring/ScreeningMetricsPanel'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import type { HiringApplication, HiringCandidate, HiringJob } from '@/types/database'
import type { HiringJobSummary, HiringScreeningMetrics } from '@/types/hiring'
import type { DuplicateReviewItem } from '@/lib/hiring/duplicates'

type ExtendedCandidate = HiringCandidate & {
    applications: (HiringApplication & { job: HiringJob })[]
}

interface HiringDashboardClientProps {
    jobs: HiringJobSummary[]
    candidates: ExtendedCandidate[]
    canCreate: boolean
    canManage: boolean
    canEdit: boolean
    duplicateItems: DuplicateReviewItem[]
    screeningMetrics: HiringScreeningMetrics
}

export function HiringDashboardClient({ jobs, candidates, canCreate, canManage, canEdit, duplicateItems, screeningMetrics }: HiringDashboardClientProps) {
    const [activeTab, setActiveTab] = useState<'jobs' | 'candidates' | 'duplicates' | 'screening'>('jobs')
    const [isAddCandidateOpen, setIsAddCandidateOpen] = useState(false)

    return (
        <PageLayout
            title="Hiring"
            subtitle="Manage job postings and candidates"
            headerActions={
                (canCreate || canManage) && (
                    <div className="flex gap-2">
                        {canManage && (
                            <>
                                <Link href="/hiring/templates">
                                    <Button variant="ghost">
                                        Templates
                                    </Button>
                                </Link>
                                <Link href="/hiring/reminders">
                                    <Button variant="ghost">
                                        Reminders
                                    </Button>
                                </Link>
                                <Link href="/hiring/retention">
                                    <Button variant="ghost">
                                        Retention
                                    </Button>
                                </Link>
                            </>
                        )}
                        {canCreate && (
                            <>
                                <Button
                                    variant="primary"
                                    onClick={() => setIsAddCandidateOpen(true)}
                                    leftIcon={<UserPlusIcon className="w-5 h-5" />}
                                >
                                    Add Candidate
                                </Button>
                                <Link href="/hiring/new">
                                    <Button variant="secondary" leftIcon={<PlusIcon className="w-5 h-5" />}>
                                        Post Job
                                    </Button>
                                </Link>
                            </>
                        )}
                    </div>
                )
            }
        >
            {/* Tabs */}
            <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {[
                        { id: 'jobs', label: `Jobs (${jobs.length})` },
                        { id: 'candidates', label: `All Candidates (${candidates.length})` },
                        { id: 'duplicates', label: `Duplicates (${duplicateItems.length})` },
                        { id: 'screening', label: 'Screening' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as 'jobs' | 'candidates' | 'duplicates' | 'screening')}
                            className={`
                            whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                            ${activeTab === tab.id
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                                }
                        `}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Content */}
            {activeTab === 'jobs' && (
                jobs.length === 0 ? (
                    <EmptyState
                        title="No jobs yet"
                        description="Create your first job posting to start hiring."
                        icon="briefcase"
                        action={
                            canCreate && (
                                <Link href="/hiring/new">
                                    <Button variant="secondary">Create Job</Button>
                                </Link>
                            )
                        }
                    />
                ) : (
                    <JobsTable jobs={jobs} />
                )
            )}

            {activeTab === 'candidates' && (
                <CandidateList candidates={candidates} />
            )}

            {activeTab === 'duplicates' && (
                <DuplicateReviewPanel initialItems={duplicateItems} canEdit={canEdit} />
            )}

            {activeTab === 'screening' && (
                <ScreeningMetricsPanel metrics={screeningMetrics} />
            )}

            {/* Modal */}
            <AddCandidateModal
                isOpen={isAddCandidateOpen}
                onClose={() => setIsAddCandidateOpen(false)}
                jobs={jobs}
            />
        </PageLayout>
    )
}
