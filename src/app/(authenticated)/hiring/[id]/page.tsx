import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { getJobById, getJobApplications } from '@/lib/hiring/service'
import { getReengagementSuggestions } from '@/lib/hiring/reengagement'
import { ApplicationsTable } from '@/components/features/hiring/ApplicationsTable'
import { ReengagementPanel } from '@/components/features/hiring/ReengagementPanel'
import { Button } from '@/components/ui-v2/forms/Button'
import { PencilSquareIcon } from '@heroicons/react/20/solid'
import { StatusIndicator } from '@/components/ui-v2/display/StatusIndicator'
import { formatDate } from '@/lib/utils'

function renderJsonBlock(value: any) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
        return <p className="text-sm text-gray-500">No data configured.</p>
    }

    if (Array.isArray(value)) {
        return (
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                {value.map((item, index) => (
                    <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                ))}
            </ul>
        )
    }

    if (typeof value === 'object') {
        return (
            <pre className="text-xs text-gray-600 bg-gray-50 rounded-md p-3 overflow-auto">
                {JSON.stringify(value, null, 2)}
            </pre>
        )
    }

    return <p className="text-sm text-gray-700">{String(value)}</p>
}

function stripHtml(value: string) {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default async function JobDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const canView = await checkUserPermission('hiring', 'view')
    const canEdit = await checkUserPermission('hiring', 'edit')
    const canSend = await checkUserPermission('hiring', 'send')

    if (!canView) {
        redirect('/unauthorized')
    }

    const [job, applications, suggestions] = await Promise.all([
        getJobById(id),
        getJobApplications(id),
        getReengagementSuggestions(id)
    ])

    if (!job) {
        notFound()
    }

    const descriptionText = job.description ? stripHtml(job.description) : 'No job description provided.'
    const postedAt = job.posting_date || job.created_at
    const closingAt = job.closing_date
    const statusLabel = job.status.replace('_', ' ')
    const statusText = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)
    const statusVariant = job.status === 'open'
        ? 'success'
        : job.status === 'draft' || job.status === 'expired'
            ? 'warning'
            : 'offline'

    return (
        <PageLayout
            title={job.title}
            subtitle={`${job.location} • ${job.employment_type}`}
            breadcrumbs={[
                { label: 'Hiring', href: '/hiring' },
                { label: job.title }
            ]}
            backButton={{
                label: 'Back to Jobs',
                href: '/hiring'
            }}
            headerActions={
                canEdit && (
                    <Link href={`/hiring/${job.id}/edit`}>
                        <Button variant="secondary" leftIcon={<PencilSquareIcon className="w-4 h-4" />}>
                            Edit Job
                        </Button>
                    </Link>
                )
            }
            containerSize="lg"
        >
            <div className="space-y-6">
                {/* Job Status Banner */}
                <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-500">Status:</span>
                        <StatusIndicator status={statusVariant} variant="badge" label={statusText} />
                    </div>
                    <div className="text-sm text-gray-500 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <span>Posted: {formatDate(postedAt)}</span>
                        <span>Closes: {closingAt ? formatDate(closingAt) : 'No closing date'}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="bg-white rounded-lg shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Job Description</h3>
                        <p className="text-sm text-gray-700 whitespace-pre-line">{descriptionText}</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Requirements</h3>
                        {renderJsonBlock(job.requirements)}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="bg-white rounded-lg shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Prerequisites</h3>
                        {renderJsonBlock(job.prerequisites)}
                    </div>
                    <div className="bg-white rounded-lg shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Screeners</h3>
                        {renderJsonBlock(job.screening_questions)}
                    </div>
                    <div className="bg-white rounded-lg shadow p-5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Scoring Rubric</h3>
                        {renderJsonBlock(job.screening_rubric)}
                    </div>
                </div>

                {/* Applications List */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                            Applications
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">
                            {applications.length} candidates found
                        </p>
                    </div>
                    <ApplicationsTable applications={applications} />
                </div>

                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
                        <h3 className="text-lg leading-6 font-medium text-gray-900">
                            Re-engagement suggestions
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">
                            Reach out to previous candidates who could be a fit for this role.
                        </p>
                    </div>
                    <div className="px-4 py-5 sm:px-6">
                        <ReengagementPanel jobId={job.id} suggestions={suggestions} canSend={canSend} />
                    </div>
                </div>
            </div>
        </PageLayout>
    )
}
