import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadHiringResume } from '@/lib/hiring/uploads'

export const dynamic = 'force-dynamic'

type SummarySection = {
  key: string
  label: string
  value: any
  hasData: boolean
}

function buildSummary(application: any) {
  const candidate = application?.candidate || {}
  const job = application?.job || {}
  const parsed = candidate?.parsed_data || {}

  const summaryText = typeof parsed.summary === 'string' ? parsed.summary : null
  const skills = Array.isArray(parsed.skills) ? parsed.skills.map((item: unknown) => String(item)) : []
  const experience = Array.isArray(parsed.experience) ? parsed.experience : []

  const contact = {
    name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim(),
    email: candidate.email || null,
    phone: candidate.phone || null,
    location: candidate.location || null,
  }

  const sections: SummarySection[] = [
    {
      key: 'contact',
      label: 'Contact details',
      value: contact,
      hasData: Boolean(contact.email || contact.phone || contact.location),
    },
    {
      key: 'summary',
      label: 'Summary',
      value: summaryText,
      hasData: Boolean(summaryText),
    },
    {
      key: 'experience',
      label: 'Experience',
      value: experience,
      hasData: Array.isArray(experience) && experience.length > 0,
    },
    {
      key: 'skills',
      label: 'Skills',
      value: skills,
      hasData: Array.isArray(skills) && skills.length > 0,
    },
  ]

  return {
    applicationId: application.id,
    jobTitle: job.title || 'Role',
    candidateName: contact.name || 'Candidate',
    resumeUrl: candidate.resume_url || null,
    sections,
  }
}

function encodeRedirectParam(value: string) {
  return encodeURIComponent(value)
}

export default async function CandidateConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>
  searchParams: Promise<{ success?: string; error?: string } | undefined>
}) {
  const { applicationId } = await params
  const sp = await searchParams
  const supabase = createAdminClient()

  const { data: application, error } = await supabase
    .from('hiring_applications')
    .select(`
      id,
      job_id,
      candidate_id,
      candidate:hiring_candidates(
        id,
        first_name,
        last_name,
        email,
        phone,
        location,
        resume_url,
        parsed_data
      ),
      job:hiring_jobs(
        id,
        title
      )
    `)
    .eq('id', applicationId)
    .single()

  if (error || !application) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-16">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow">
          <h1 className="text-xl font-semibold text-gray-900">We couldn&apos;t find that application</h1>
          <p className="mt-2 text-sm text-gray-600">This confirmation link may have expired. Please contact the manager if you need help.</p>
        </div>
      </main>
    )
  }

  const summary = buildSummary(application)
  const visibleSections = summary.sections.filter((section) => section.hasData)
  const success = sp?.success === '1'
  const errorMessage = typeof sp?.error === 'string' ? sp.error : null

  const handleConfirm = async (formData: FormData) => {
    'use server'

    const admin = createAdminClient()
    const confirmed = formData.getAll('confirmations').map((entry) => String(entry))
    const note = String(formData.get('note') || '').trim()
    const file = formData.get('resume')

    const { data: currentApp } = await admin
      .from('hiring_applications')
      .select('id, candidate_id, job_id')
      .eq('id', applicationId)
      .single()

    if (!currentApp) {
      redirect(`/hiring/applications/${applicationId}/confirm?error=${encodeRedirectParam('Application not found')}`)
    }

    const requiredKeys = visibleSections.map((section) => section.key)
    const missingConfirmations = requiredKeys.filter((key) => !confirmed.includes(key))

    const hasFile = file instanceof File && file.size > 0
    if (missingConfirmations.length > 0 && !note && !hasFile) {
      redirect(`/hiring/applications/${applicationId}/confirm?error=${encodeRedirectParam('Please confirm each section or leave a note.')}`)
    }

    if (confirmed.length === 0 && !note && !hasFile) {
      redirect(`/hiring/applications/${applicationId}/confirm?error=${encodeRedirectParam('Please confirm details, add a note, or upload a new CV.')}`)
    }

    const metadata: Record<string, any> = {}
    if (confirmed.length > 0) {
      metadata.confirmations = Object.fromEntries(confirmed.map((key) => [key, true]))
    }
    if (note) {
      metadata.note = note
    }

    let resumeUrl: string | null = null
    let storagePath: string | null = null
    let documentId: string | null = null

    if (hasFile) {
      const upload = await uploadHiringResume(file as File)
      storagePath = upload.storagePath
      resumeUrl = upload.publicUrl

      const { data: document, error: documentError } = await admin
        .from('hiring_candidate_documents')
        .insert({
          candidate_id: currentApp.candidate_id,
          storage_path: upload.storagePath,
          file_name: upload.fileName,
          mime_type: upload.mimeType,
          file_size_bytes: upload.fileSize,
          source: 'website',
        })
        .select('id')
        .single()

      if (!documentError) {
        documentId = document?.id ?? null
      }

      await admin
        .from('hiring_candidates')
        .update({ resume_url: upload.publicUrl })
        .eq('id', currentApp.candidate_id)

      metadata.resume = {
        storage_path: upload.storagePath,
        resume_url: upload.publicUrl,
        document_id: documentId,
      }
    }

    await admin.from('hiring_candidate_events').insert({
      candidate_id: currentApp.candidate_id,
      application_id: currentApp.id,
      job_id: currentApp.job_id,
      event_type: 'candidate_confirmation',
      source: 'website',
      metadata,
    })

    if (hasFile) {
      const { jobQueue } = await import('@/lib/unified-job-queue')
      await jobQueue.enqueue('parse_cv', {
        candidateId: currentApp.candidate_id,
        resumeUrl,
        storagePath,
        documentId,
        applicationId: currentApp.id,
        jobId: currentApp.job_id,
      })
    }

    redirect(`/hiring/applications/${applicationId}/confirm?success=1`)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-2xl bg-white p-8 shadow">
          <p className="text-xs uppercase tracking-wide text-gray-500">The Anchor</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Confirm your details</h1>
          <p className="mt-2 text-sm text-gray-600">
            Thanks for applying for the {summary.jobTitle} role. Please review the details we pulled from your CV.
          </p>
        </div>

        {success && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-6 py-4 text-sm text-green-700">
            Thanks! Your confirmation has been recorded.
          </div>
        )}

        {errorMessage && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <form action={handleConfirm} className="space-y-6">
          {visibleSections.map((section) => (
            <div key={section.key} className="rounded-2xl bg-white p-6 shadow">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{section.label}</h2>
                  {section.key === 'contact' && (
                    <dl className="mt-3 space-y-2 text-sm text-gray-600">
                      <div><span className="font-medium text-gray-800">Name:</span> {section.value.name || 'Not found'}</div>
                      <div><span className="font-medium text-gray-800">Email:</span> {section.value.email || 'Not found'}</div>
                      <div><span className="font-medium text-gray-800">Phone:</span> {section.value.phone || 'Not found'}</div>
                      <div><span className="font-medium text-gray-800">Location:</span> {section.value.location || 'Not found'}</div>
                    </dl>
                  )}
                  {section.key === 'summary' && (
                    <p className="mt-3 text-sm text-gray-600">{section.value}</p>
                  )}
                  {section.key === 'experience' && (
                    <ul className="mt-3 space-y-3 text-sm text-gray-600">
                      {section.value.map((item: any, index: number) => (
                        <li key={index} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                          <div className="font-medium text-gray-800">{item.role || 'Role'}</div>
                          <div className="text-xs text-gray-500">{item.company || 'Company'} · {item.start_date || 'Start'} - {item.end_date || 'Present'}</div>
                          {item.description && <p className="mt-2 text-xs text-gray-600">{item.description}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.key === 'skills' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {section.value.map((skill: string) => (
                        <span key={skill} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    name="confirmations"
                    value={section.key}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  Looks correct
                </label>
              </div>
            </div>
          ))}

          <div className="rounded-2xl bg-white p-6 shadow space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-900">Anything to update?</label>
              <p className="text-xs text-gray-500">Add a short note if something changed since you applied.</p>
              <textarea
                name="note"
                rows={4}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                placeholder="Let us know if anything needs updating..."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-900">Upload a newer CV (optional)</label>
              <input
                type="file"
                name="resume"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif"
                className="mt-2 block w-full text-sm text-gray-600 file:mr-4 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
              {summary.resumeUrl && (
                <p className="mt-2 text-xs text-gray-500">We already have your latest CV on file.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-green-700"
            >
              Submit confirmation
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
