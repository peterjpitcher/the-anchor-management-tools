import { redirect, notFound } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { getApplicationById, getApplicationMessages, getScreeningRunsForApplication } from '@/lib/hiring/service'
import { getHiringNotes } from '@/lib/hiring/notes'
import { ApplicationStatusSelect } from '@/components/features/hiring/ApplicationStatusSelect'
import { ScheduleInterviewButton } from '@/components/features/hiring/ScheduleInterviewButton'
import { ApplicationScreeningPanel } from '@/components/features/hiring/ApplicationScreeningPanel'
import { ApplicationMessagesPanel } from '@/components/features/hiring/ApplicationMessagesPanel'
import { ApplicationOutcomePanel } from '@/components/features/hiring/ApplicationOutcomePanel'
import { ApplicationOverridePanel } from '@/components/features/hiring/ApplicationOverridePanel'
import { HiringNotesPanel } from '@/components/features/hiring/HiringNotesPanel'
import { DocumentTextIcon, PhoneIcon, EnvelopeIcon, MapPinIcon } from '@heroicons/react/24/outline'
import { DeleteCandidateButton } from '@/components/features/hiring/DeleteCandidateButton'

export default async function ApplicationDetailsPage({ params }: { params: Promise<{ applicationId: string }> }) {
    const { applicationId } = await params
    const canView = await checkUserPermission('hiring', 'view')
    const canEdit = await checkUserPermission('hiring', 'edit')
    const canSend = await checkUserPermission('hiring', 'send')
    const canDelete = await checkUserPermission('hiring', 'delete') // Check explicit delete

    if (!canView) {
        redirect('/unauthorized')
    }

    const application = await getApplicationById(applicationId)
    const [messages, notes, screeningRuns] = await Promise.all([
        getApplicationMessages(applicationId),
        getHiringNotes('application', applicationId),
        getScreeningRunsForApplication(applicationId),
    ])

    if (!application) {
        notFound()
    }

    const { candidate, job, screener_answers } = application
    const parsedData = candidate.parsed_data as any // Cast for now until we have strict types for parsed JSON
    const screeningResult = application.ai_screening_result as any | null
    const screeningStatus = application.screening_status
        || (screeningResult ? 'success' : application.stage === 'screening' ? 'processing' : null)
    const defaultMessageType = application.outcome_status === 'rejected' ? 'feedback' : undefined

    return (
        <PageLayout
            title={`${candidate.first_name} ${candidate.last_name}`}
            subtitle={`Applied for ${job.title}`}
            breadcrumbs={[
                { label: 'Hiring', href: '/hiring' },
                { label: job.title, href: `/hiring/${job.id}` },
                { label: 'Application' }
            ]}
            backButton={{
                label: 'Back to Job',
                href: `/hiring/${job.id}`
            }}
            headerActions={
                canEdit && (
                    <>
                        <ApplicationStatusSelect
                            applicationId={application.id}
                            currentStatus={application.stage}
                        />
                        <ScheduleInterviewButton
                            applicationId={application.id}
                            candidateName={`${candidate.first_name} ${candidate.last_name}`}
                        />
                        {(canDelete || canEdit) && (
                            <DeleteCandidateButton
                                candidateId={candidate.id}
                                candidateName={`${candidate.first_name} ${candidate.last_name}`}
                            />
                        )}
                    </>
                )
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Parsed Resume / Main Content */}
                <div className="lg:col-span-2 space-y-6">

                    <ApplicationScreeningPanel
                        applicationId={application.id}
                        screeningResult={screeningResult}
                        screeningStatus={screeningStatus}
                        screeningError={application.screening_error}
                        score={application.ai_score}
                        recommendation={application.ai_recommendation}
                        confidence={application.ai_confidence}
                        latestRunId={application.latest_screening_run_id}
                        runs={screeningRuns}
                        canEdit={canEdit}
                    />

                    {screeningResult && canEdit && (
                        <ApplicationOverridePanel
                            applicationId={application.id}
                            currentScore={application.ai_score}
                            currentRecommendation={application.ai_recommendation}
                            canEdit={canEdit}
                        />
                    )}


                    {/* AI Summary / Skills if available */}
                    {parsedData?.summary && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Summary (AI Extracted)</h3>
                            <p className="text-gray-600 text-sm leading-relaxed">{parsedData.summary}</p>
                        </div>
                    )}

                    {parsedData?.experience && Array.isArray(parsedData.experience) && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Experience</h3>
                            <div className="space-y-6">
                                {parsedData.experience.map((exp: any, i: number) => (
                                    <div key={i} className="border-l-2 border-gray-200 pl-4">
                                        <h4 className="font-medium text-gray-900">{exp.role}</h4>
                                        <div className="text-sm text-gray-500">{exp.company} • {exp.start_date} - {exp.end_date || 'Present'}</div>
                                        {exp.description && <p className="mt-2 text-sm text-gray-600">{exp.description}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Raw Screener Answers if we had them */}
                    {screener_answers && Object.keys(screener_answers).length > 0 && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Screener Questions</h3>
                            <dl className="space-y-4">
                                {Object.entries(screener_answers).map(([question, answer]: [string, any]) => (
                                    <div key={question}>
                                        <dt className="text-sm font-medium text-gray-500">{question}</dt>
                                        <dd className="mt-1 text-sm text-gray-900">{String(answer)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}

                    <ApplicationMessagesPanel
                        applicationId={application.id}
                        initialMessages={messages}
                        canSend={canSend}
                        initialMessageType={defaultMessageType}
                    />

                    {/* Fallback if no parsed data */}
                    {(!parsedData || Object.keys(parsedData).length === 0) && (
                        <div className="bg-white shadow rounded-lg p-12 text-center text-gray-500">
                            <DocumentTextIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No parsed resume data available.</p>
                            {candidate.resume_url && (
                                <a href={candidate.resume_url} target="_blank" className="text-green-600 hover:underline text-sm font-medium mt-2 block">
                                    View Original Resume
                                </a>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Column: Contact & Meta */}
                <div className="space-y-6">
                    <div className="bg-white shadow rounded-lg p-6">
                        <h3 className="text-base font-medium text-gray-900 mb-4">Contact Details</h3>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-sm text-gray-600">
                                <EnvelopeIcon className="w-5 h-5 text-gray-400" />
                                <a href={`mailto:${candidate.email}`} className="hover:text-green-600">{candidate.email}</a>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-gray-600">
                                <PhoneIcon className="w-5 h-5 text-gray-400" />
                                <a href={`tel:${candidate.phone}`} className="hover:text-green-600">{candidate.phone}</a>
                            </div>
                            {parsedData?.location && (
                                <div className="flex items-center gap-3 text-sm text-gray-600">
                                    <MapPinIcon className="w-5 h-5 text-gray-400" />
                                    <span>{parsedData.location}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white shadow rounded-lg p-6">
                        <h3 className="text-base font-medium text-gray-900 mb-4">Application Info</h3>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Applied</span>
                                <span className="text-gray-900">{new Date(application.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Source</span>
                                <span className="text-gray-900 capitalize">{application.source}</span>
                            </div>
                            {application.interview_date && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Interview</span>
                                    <span className="text-gray-900">{new Date(application.interview_date).toLocaleString()}</span>
                                </div>
                            )}
                            {application.outcome_status && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Outcome</span>
                                    <span className="text-gray-900 capitalize">{application.outcome_status.replace('_', ' ')}</span>
                                </div>
                            )}
                            {application.outcome_reason_category && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Outcome reason</span>
                                    <span className="text-gray-900 capitalize">{application.outcome_reason_category.replace('_', ' ')}</span>
                                </div>
                            )}
                            {candidate.resume_url && (
                                <div className="pt-4 border-t border-gray-100">
                                    <a
                                        href={candidate.resume_url}
                                        target="_blank"
                                        className="w-full flex justify-center items-center gap-2 px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                                    >
                                        <DocumentTextIcon className="w-4 h-4 text-gray-500" />
                                        View Original Resume
                                    </a>
                                </div>
                            )}
                            <div className="pt-4 border-t border-gray-100">
                                <a
                                    href={`/api/hiring/applications/${application.id}/interview-template`}
                                    target="_blank"
                                    className="w-full flex justify-center items-center gap-2 px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                                >
                                    <DocumentTextIcon className="w-4 h-4 text-gray-500" />
                                    Download Interview Template
                                </a>
                            </div>
                        </div>
                    </div>

                    <ApplicationOutcomePanel
                        applicationId={application.id}
                        canEdit={canEdit}
                        initialStatus={application.outcome_status}
                        initialReasonCategory={application.outcome_reason_category}
                        initialReason={application.outcome_reason}
                        initialNotes={application.outcome_notes}
                        recordedAt={application.outcome_recorded_at}
                        reviewedAt={application.outcome_reviewed_at}
                    />

                    <HiringNotesPanel
                        entityType="application"
                        entityId={application.id}
                        canEdit={canEdit}
                        initialNotes={notes}
                    />
                </div>
            </div>
        </PageLayout>
    )
}
