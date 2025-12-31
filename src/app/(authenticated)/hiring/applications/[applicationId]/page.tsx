import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { getApplicationById, getApplicationMessages } from '@/lib/hiring/service'
import { getHiringNotes } from '@/lib/hiring/notes'
import { ApplicationStatusSelect } from '@/components/features/hiring/ApplicationStatusSelect'
import { ScheduleInterviewButton } from '@/components/features/hiring/ScheduleInterviewButton'
import { Badge } from '@/components/ui-v2/display/Badge'
import { ApplicationMessagesPanel } from '@/components/features/hiring/ApplicationMessagesPanel'
import { ApplicationOutcomePanel } from '@/components/features/hiring/ApplicationOutcomePanel'
import { ApplicationOverridePanel } from '@/components/features/hiring/ApplicationOverridePanel'
import { HiringNotesPanel } from '@/components/features/hiring/HiringNotesPanel'
import { DocumentTextIcon, PhoneIcon, EnvelopeIcon, MapPinIcon } from '@heroicons/react/24/outline'

export default async function ApplicationDetailsPage({ params }: { params: Promise<{ applicationId: string }> }) {
    const { applicationId } = await params
    const canView = await checkUserPermission('hiring', 'view')
    const canEdit = await checkUserPermission('hiring', 'edit')
    const canSend = await checkUserPermission('hiring', 'send')

    if (!canView) {
        redirect('/unauthorized')
    }

    const application = await getApplicationById(applicationId)
    const [messages, notes] = await Promise.all([
        getApplicationMessages(applicationId),
        getHiringNotes('application', applicationId),
    ])

    if (!application) {
        notFound()
    }

    const { candidate, job, screener_answers } = application
    const parsedData = candidate.parsed_data as any // Cast for now until we have strict types for parsed JSON
    const screeningResult = application.ai_screening_result as any | null
    const recommendation = application.ai_recommendation || ''
    const recommendationLabel = recommendation ? recommendation.charAt(0).toUpperCase() + recommendation.slice(1) : 'Pending'
    const recommendationVariant =
        recommendation === 'invite'
            ? 'success'
            : recommendation === 'clarify'
                ? 'warning'
                : recommendation === 'hold'
                    ? 'info'
                    : recommendation === 'reject'
                        ? 'error'
                        : 'neutral'

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
            containerSize="lg"
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
                    </>
                )
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Parsed Resume / Main Content */}
                <div className="lg:col-span-2 space-y-6">

                    {screeningResult && (
                        <div className="bg-white shadow rounded-lg p-6 space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-medium text-gray-900">AI Screening</h3>
                                    <p className="text-sm text-gray-500">Review before sending any response.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge variant="info">Score {application.ai_score ?? 'N/A'}/10</Badge>
                                    <Badge variant={recommendationVariant}>{recommendationLabel}</Badge>
                                </div>
                            </div>

                            {screeningResult?.rationale && (
                                <div className="text-sm text-gray-700">{screeningResult.rationale}</div>
                            )}

                            {screeningResult?.experience_analysis && (
                                <div className="text-sm text-gray-700">
                                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Experience analysis</h4>
                                    <p>{screeningResult.experience_analysis}</p>
                                </div>
                            )}

                            {Array.isArray(screeningResult?.eligibility) && screeningResult.eligibility.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-gray-900">Eligibility checklist</h4>
                                    <div className="space-y-2">
                                        {screeningResult.eligibility.map((item: any, index: number) => {
                                            const status = item?.status || 'unclear'
                                            const badgeVariant = status === 'yes' ? 'success' : status === 'no' ? 'error' : 'warning'
                                            return (
                                                <div key={index} className="flex items-start gap-3">
                                                    <Badge variant={badgeVariant} size="sm">
                                                        {status.toUpperCase()}
                                                    </Badge>
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900">
                                                            {item?.label || item?.key || 'Requirement'}
                                                        </div>
                                                        {item?.justification && (
                                                            <div className="text-xs text-gray-600">{item.justification}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.isArray(screeningResult?.strengths) && screeningResult.strengths.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-900 mb-2">Strengths</h4>
                                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                            {screeningResult.strengths.map((item: string, index: number) => (
                                                <li key={index}>{item}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {Array.isArray(screeningResult?.concerns) && screeningResult.concerns.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-900 mb-2">Concerns / Missing info</h4>
                                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                            {screeningResult.concerns.map((item: string, index: number) => (
                                                <li key={index}>{item}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {screeningResult && canEdit && (
                        <ApplicationOverridePanel
                            applicationId={application.id}
                            currentScore={application.ai_score}
                            currentRecommendation={application.ai_recommendation}
                            canEdit={canEdit}
                        />
                    )}

                    {!screeningResult && application.stage === 'screening' && (
                        <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-600">
                            Screening is in progress. Check back shortly for AI results.
                        </div>
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
