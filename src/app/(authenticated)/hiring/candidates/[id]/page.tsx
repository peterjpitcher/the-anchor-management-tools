
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { getCandidateById } from '@/lib/hiring/service'
import { getHiringNotes } from '@/lib/hiring/notes'
import { HiringNotesPanel } from '@/components/features/hiring/HiringNotesPanel'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { ArrowTopRightOnSquareIcon, PaperClipIcon } from '@heroicons/react/20/solid'
import { formatDate } from '@/lib/utils'

export default async function CandidateProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const canView = await checkUserPermission('hiring', 'view')
    const canEdit = await checkUserPermission('hiring', 'edit')

    if (!canView) {
        redirect('/unauthorized')
    }

    const candidate = await getCandidateById(id)
    const notes = await getHiringNotes('candidate', id)

    if (!candidate) {
        notFound()
    }

    const parsedData = candidate.parsed_data as any || {}
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const profileVersions = (candidate as any).profile_versions || []
    const applicationCount = candidate.applications?.length || 0
    const lastAppliedAt = candidate.applications
        ?.map((app) => app.created_at)
        .filter(Boolean)
        .sort()
        .pop()

    const buildDocumentUrl = (storagePath?: string | null) => {
        if (!storagePath) return null
        if (storagePath.startsWith('http')) return storagePath
        if (!supabaseUrl) return null
        return `${supabaseUrl}/storage/v1/object/public/hiring-docs/${storagePath}`
    }

    const sortedVersions = profileVersions
        .slice()
        .sort((a: any, b: any) => (b.version_number || 0) - (a.version_number || 0))

    return (
        <PageLayout
            title={`${candidate.first_name} ${candidate.last_name}`}
            subtitle={candidate.email}
            breadcrumbs={[
                { label: 'Hiring', href: '/hiring' },
                { label: 'Candidates', href: '/hiring?tab=candidates' },
                { label: `${candidate.first_name} ${candidate.last_name}` }
            ]}
            backButton={{
                label: 'Back to Candidates',
                href: '/hiring'
            }}
            containerSize="lg"
        >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Left Column: Parsed Info */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">
                            Contact Information
                        </h3>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Primary Email</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{candidate.email}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Secondary Emails</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                                    {candidate.secondary_emails?.length ? candidate.secondary_emails.join(', ') : '-'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Phone</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{candidate.phone || '-'}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Location</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{candidate.location || '-'}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Added</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formatDate(candidate.created_at)}</dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Applications</dt>
                                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                                    {applicationCount > 0
                                        ? `${applicationCount} (last ${lastAppliedAt ? formatDate(lastAppliedAt) : '-'})`
                                        : 'None'}
                                </dd>
                            </div>
                        </dl>

                        {candidate.resume_url && (
                            <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
                                <Link href={candidate.resume_url} target="_blank" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-500">
                                    <PaperClipIcon className="w-4 h-4" />
                                    View Original Resume
                                </Link>
                            </div>
                        )}
                    </div>

                    {/* CV History */}
                    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">
                            CV History
                        </h3>
                        {sortedVersions.length === 0 ? (
                            <p className="text-gray-500 italic">No CV history available.</p>
                        ) : (
                            <ul className="space-y-4">
                                {sortedVersions.map((version: any) => {
                                    const document = version.document
                                    const documentUrl = buildDocumentUrl(document?.storage_path || null)
                                    return (
                                        <li key={version.id} className="border border-gray-200 dark:border-gray-700 rounded-md p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                        Version {version.version_number}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {formatDate(version.created_at)}
                                                    </div>
                                                </div>
                                                {documentUrl && (
                                                    <Link
                                                        href={documentUrl}
                                                        target="_blank"
                                                        className="text-xs text-blue-600 hover:text-blue-500"
                                                    >
                                                        View CV
                                                    </Link>
                                                )}
                                            </div>
                                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                                                {version.diff_summary || 'No changes detected'}
                                            </div>
                                            {document?.file_name && (
                                                <div className="mt-1 text-xs text-gray-500">
                                                    File: {document.file_name}
                                                </div>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>

                    {/* Parsed CV Data */}
                    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">
                            Parsed CV Details
                        </h3>
                        {Object.keys(parsedData).length === 0 ? (
                            <p className="text-gray-500 italic">No parsed data available.</p>
                        ) : (
                            <div className="space-y-4">
                                {parsedData.summary && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Summary</h4>
                                        <p className="mt-1 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{parsedData.summary}</p>
                                    </div>
                                )}
                                {parsedData.skills && parsedData.skills.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Skills</h4>
                                        <div className="mt-1 flex flex-wrap gap-2">
                                            {parsedData.skills.map((skill: string, idx: number) => (
                                                <Badge key={idx} variant="default">{skill}</Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {parsedData.experience && parsedData.experience.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Experience</h4>
                                        <ul className="space-y-4">
                                            {parsedData.experience.map((exp: any, idx: number) => (
                                                <li key={idx} className="border-l-2 border-gray-200 pl-4">
                                                    <div className="font-medium text-gray-900 dark:text-white">{exp.role}</div>
                                                    <div className="text-sm text-gray-500">{exp.company} • {exp.start_date} - {exp.end_date || 'Present'}</div>
                                                    {exp.description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{exp.description}</p>}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Applications */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">
                            Applications
                        </h3>
                        {candidate.applications.length === 0 ? (
                            <p className="text-gray-500 text-sm">No applications yet.</p>
                        ) : (
                            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                {candidate.applications.map((app) => (
                                    <li key={app.id} className="py-4 first:pt-0 last:pb-0">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-medium text-gray-900 dark:text-white">{app.job.title}</div>
                                                <div className="text-xs text-gray-500">{formatDate(app.created_at)}</div>
                                            </div>
                                            <Badge variant="info">{app.stage}</Badge>
                                        </div>
                                        <div className="mt-2">
                                            <Link href={`/hiring/applications/${app.id}`}>
                                                <Button size="sm" variant="ghost" rightIcon={<ArrowTopRightOnSquareIcon className="w-3 h-3" />}>
                                                    View App
                                                </Button>
                                            </Link>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <HiringNotesPanel
                        entityType="candidate"
                        entityId={candidate.id}
                        canEdit={canEdit}
                        initialNotes={notes}
                    />
                </div>
            </div>
        </PageLayout>
    )
}
