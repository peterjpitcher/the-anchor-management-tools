import 'server-only'
import type { HiringApplication, HiringCandidate, HiringJob, HiringJobTemplate } from '@/types/database'

const STANDARD_QUESTIONS = [
    'Tell us about yourself and your hospitality experience.',
    'What appeals to you about working at The Anchor?',
    'Walk us through a busy service you handled well.',
    'How do you handle difficult customers or conflict?',
    'What is your availability and preferred shifts?',
]

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function stripHtml(value: string) {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeQuestions(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    return input
        .map((entry) => {
            if (typeof entry === 'string') return entry
            if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>
                return (
                    (typeof record.question === 'string' && record.question) ||
                    (typeof record.label === 'string' && record.label) ||
                    (typeof record.prompt === 'string' && record.prompt) ||
                    ''
                )
            }
            return ''
        })
        .map((value) => value.trim())
        .filter(Boolean)
}

function formatExperience(experience: any[]) {
    if (!Array.isArray(experience) || experience.length === 0) return ''
    return experience.slice(0, 3).map((item) => {
        const role = item?.role ? escapeHtml(String(item.role)) : 'Role'
        const company = item?.company ? escapeHtml(String(item.company)) : 'Company'
        const dates = [item?.start_date, item?.end_date].filter(Boolean).join(' - ')
        return `<li><strong>${role}</strong> at ${company}${dates ? ` (${escapeHtml(dates)})` : ''}</li>`
    }).join('')
}

export function generateInterviewTemplateHtml(input: {
    application: HiringApplication
    candidate: HiringCandidate
    job: HiringJob
    template?: HiringJobTemplate | null
}) {
    const candidateName = `${input.candidate.first_name} ${input.candidate.last_name}`.trim()
    const parsedData = (input.candidate.parsed_data || {}) as Record<string, any>
    const summary =
        parsedData?.summary ||
        (input.application.ai_screening_result as any)?.rationale ||
        'No summary available.'
    const strengths = Array.isArray((input.application.ai_screening_result as any)?.strengths)
        ? (input.application.ai_screening_result as any).strengths
        : []
    const concerns = Array.isArray((input.application.ai_screening_result as any)?.concerns)
        ? (input.application.ai_screening_result as any).concerns
        : []

    const jobDescription = input.job.description ? stripHtml(input.job.description) : 'No job description provided.'
    const standardQuestions = normalizeQuestions(input.template?.interview_questions)
    const resolvedStandardQuestions = standardQuestions.length > 0 ? standardQuestions : STANDARD_QUESTIONS
    const jobQuestions = normalizeQuestions(input.job.interview_questions)
    const extraQuestions = jobQuestions.length > 0 ? jobQuestions : ['None provided.']

    const experienceList = formatExperience(Array.isArray(parsedData?.experience) ? parsedData.experience : [])
    const strengthList = strengths.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('')
    const concernList = concerns.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('')

    const notesLines = Array.from({ length: 10 }).map(() => '<div class="line"></div>').join('')

    return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Interview Template - ${escapeHtml(candidateName)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 24px; }
          h1 { font-size: 22px; margin-bottom: 6px; }
          h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; }
          p { font-size: 13px; line-height: 1.5; margin: 0 0 8px; }
          ul { margin: 0 0 8px 18px; padding: 0; font-size: 13px; }
          .meta { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
          .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
          .line { border-bottom: 1px dashed #d1d5db; height: 18px; }
        </style>
      </head>
      <body>
        <h1>Interview Pack</h1>
        <div class="meta">Generated for ${escapeHtml(candidateName)} - ${escapeHtml(input.job.title)}</div>

        <div class="box">
          <h2>Candidate Details</h2>
          <p><strong>Name:</strong> ${escapeHtml(candidateName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(input.candidate.email || 'N/A')}</p>
          <p><strong>Phone:</strong> ${escapeHtml(input.candidate.phone || 'N/A')}</p>
          <p><strong>Location:</strong> ${escapeHtml(input.candidate.location || 'N/A')}</p>
        </div>

        <div class="box">
          <h2>Summary</h2>
          <p>${escapeHtml(summary)}</p>
          ${experienceList ? `<h2>Recent Experience</h2><ul>${experienceList}</ul>` : ''}
        </div>

        <div class="grid">
          <div class="box">
            <h2>Strengths</h2>
            ${strengthList ? `<ul>${strengthList}</ul>` : '<p>None noted yet.</p>'}
          </div>
          <div class="box">
            <h2>Concerns / Missing Info</h2>
            ${concernList ? `<ul>${concernList}</ul>` : '<p>No concerns recorded.</p>'}
          </div>
        </div>

        <div class="box">
          <h2>Job Context</h2>
          <p>${escapeHtml(jobDescription)}</p>
        </div>

        <div class="box">
          <h2>Standard Questions</h2>
          <ul>
            ${resolvedStandardQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}
          </ul>
        </div>

        <div class="box">
          <h2>Job-Specific Questions</h2>
          <ul>
            ${extraQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}
          </ul>
        </div>

        <div class="box">
          <h2>Notes</h2>
          ${notesLines}
        </div>
      </body>
    </html>
  `
}
