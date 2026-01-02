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

const APPLICATIONS_PAGE_SIZE = 20

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

function buildPaginationRange(currentPage: number, totalPages: number) {
    const pages: Array<number | 'ellipsis'> = []
    const maxPagesToShow = 7
    const halfRange = Math.floor(maxPagesToShow / 2)

    if (totalPages <= maxPagesToShow) {
        for (let page = 1; page <= totalPages; page += 1) {
            pages.push(page)
        }
        return pages
    }

    pages.push(1)

    if (currentPage > halfRange + 2) {
        pages.push('ellipsis')
    }

    const start = Math.max(2, currentPage - halfRange)
    const end = Math.min(totalPages - 1, currentPage + halfRange)

    for (let page = start; page <= end; page += 1) {
        pages.push(page)
    }

    if (currentPage < totalPages - halfRange - 1) {
        pages.push('ellipsis')
    }

    pages.push(totalPages)
    return pages
}

function buildJobQueryString(input: { includeHidden: boolean; page?: number }) {
    const params = new URLSearchParams()
    if (input.includeHidden) {
        params.set('show_hidden', 'true')
    }
    if (input.page && input.page > 1) {
        params.set('page', String(input.page))
    }
    const query = params.toString()
    return query ? `?${query}` : ''
}

export default async function JobDetailsPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ show_hidden?: string; page?: string }>
}) {
    const { id } = await params
    const { show_hidden, page } = await searchParams
    const includeHidden = show_hidden === 'true'
    const parsedPage = Number.parseInt(page || '', 10)
    const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1

    const canView = await checkUserPermission('hiring', 'view')
    const canEdit = await checkUserPermission('hiring', 'edit')
    const canSend = await checkUserPermission('hiring', 'send')

    if (!canView) {
        redirect('/unauthorized')
    }

    const [job, applicationsPage, suggestions] = await Promise.all([
        getJobById(id),
        getJobApplications(id, { includeHidden, page: requestedPage, pageSize: APPLICATIONS_PAGE_SIZE }),
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

    const { applications, totalCount, page: currentPage, pageSize } = applicationsPage
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0
    const activePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1
    const startItem = totalCount === 0 ? 0 : (activePage - 1) * pageSize + 1
    const endItem = totalCount === 0 ? 0 : Math.min(activePage * pageSize, totalCount)
    const pageNumbers = totalPages > 1 ? buildPaginationRange(activePage, totalPages) : []
    const countLabel = `${totalCount} candidates found${includeHidden ? ' (showing all)' : ''}`
    const pageLabel = totalPages > 1 ? ` • Page ${activePage} of ${totalPages}` : ''
    const buildPageHref = (pageNumber: number, nextIncludeHidden = includeHidden) =>
        `/hiring/${job.id}${buildJobQueryString({ includeHidden: nextIncludeHidden, page: pageNumber })}`

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

                {/* Applications List */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="px-4 py-5 border-b border-gray-200 sm:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h3 className="text-lg leading-6 font-medium text-gray-900">
                                Applications
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm text-gray-500">
                                {countLabel}
                                {pageLabel}
                            </p>
                        </div>
                        <div>
                            <Link
                                href={buildPageHref(1, !includeHidden)}
                                scroll={false}
                            >
                                <Button variant="secondary" size="sm">
                                    {includeHidden ? 'Hide Rejected' : 'Show Rejected'}
                                </Button>
                            </Link>
                        </div>
                    </div>
                    <ApplicationsTable applications={applications} />
                    {totalPages > 1 && (
                        <div className="px-4 py-4 border-t border-gray-200 sm:px-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm text-gray-500">
                                Showing <span className="font-medium">{startItem}</span> to{' '}
                                <span className="font-medium">{endItem}</span> of{' '}
                                <span className="font-medium">{totalCount}</span>
                            </div>
                            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                                {activePage > 1 ? (
                                    <Link
                                        href={buildPageHref(activePage - 1)}
                                        scroll={false}
                                        className="relative inline-flex items-center px-3 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 active:bg-gray-100 min-h-[40px] transition-colors"
                                    >
                                        Previous
                                    </Link>
                                ) : (
                                    <span className="relative inline-flex items-center px-3 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 opacity-50 cursor-not-allowed min-h-[40px] transition-colors">
                                        Previous
                                    </span>
                                )}
                                {pageNumbers.map((pageItem, index) => {
                                    if (pageItem === 'ellipsis') {
                                        return (
                                            <span
                                                key={`ellipsis-${index}`}
                                                className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 min-h-[40px]"
                                            >
                                                ...
                                            </span>
                                        )
                                    }

                                    const isActive = pageItem === activePage
                                    return (
                                        <Link
                                            key={pageItem}
                                            href={buildPageHref(pageItem)}
                                            scroll={false}
                                            aria-current={isActive ? 'page' : undefined}
                                            className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium min-h-[40px] min-w-[40px] transition-colors ${isActive
                                                ? 'z-10 bg-gray-100 border-gray-400 text-gray-900'
                                                : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 active:bg-gray-100'
                                                }`}
                                        >
                                            {pageItem}
                                        </Link>
                                    )
                                })}
                                {activePage < totalPages ? (
                                    <Link
                                        href={buildPageHref(activePage + 1)}
                                        scroll={false}
                                        className="relative inline-flex items-center px-3 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 active:bg-gray-100 min-h-[40px] transition-colors"
                                    >
                                        Next
                                    </Link>
                                ) : (
                                    <span className="relative inline-flex items-center px-3 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 opacity-50 cursor-not-allowed min-h-[40px] transition-colors">
                                        Next
                                    </span>
                                )}
                            </nav>
                        </div>
                    )}
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
            </div>
        </PageLayout >
    )
}
