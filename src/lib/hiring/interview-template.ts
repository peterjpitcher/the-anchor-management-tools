import 'server-only'
import type { HiringApplication, HiringCandidate, HiringJob, HiringJobTemplate } from '@/types/database'

// Questions exactly as per the user's request/image
const ANCHOR_QUESTIONS = [
  'What experience do you have with handling cash?',
  'How do you feel about working evenings or weekends?',
  'We are one-team here at The Anchor, how well do you work with other people?',
  'Do you have any experience working with food?',
  'Would you be interested in shifts in our kitchen?',
  {
    question: 'Do you have any relevant certification?',
    subQuestions: [
      'Food Hygiene: Yes / No | Expiration: ________________',
      'Personal License: Yes / No | Expiration: ________________',
      'Other: ____________________________________________________'
    ]
  },
  'What does your availability look like?',
  'Could we contact you about short notice shifts in the event of sickness?'
]

function escapeHtml(value: string | null | undefined) {
  if (!value) return ''
  return String(value)
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
  if (!Array.isArray(experience) || experience.length === 0) return '<li>No experience parsed.</li>'
  return experience.slice(0, 5).map((item) => {
    const role = item?.role ? escapeHtml(String(item.role)) : 'Role'
    const company = item?.company ? escapeHtml(String(item.company)) : 'Company'
    const dates = [item?.start_date, item?.end_date].filter(Boolean).join(' - ')
    const description = item?.description ? escapeHtml(String(item.description)).slice(0, 150) + '...' : ''
    return `
            <li style="margin-bottom: 8px;">
                <div style="font-weight: bold;">${role} at ${company} <span style="font-weight: normal; color: #6b7280; font-size: 0.9em;">(${dates || 'Dates N/A'})</span></div>
                ${description ? `<div style="font-size: 0.9em; color: #4b5563;">${description}</div>` : ''}
            </li>
        `
  }).join('')
}

export function generateInterviewTemplateHtml(input: {
  application: HiringApplication
  candidate: HiringCandidate
  job: HiringJob
  template?: HiringJobTemplate | null
  logoUrl?: string
}) {
  const candidateName = `${input.candidate.first_name} ${input.candidate.last_name}`.trim()
  const parsedData = (input.candidate.parsed_data || {}) as Record<string, any>

  // AI Content logic
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

  // Job Data
  const jobDescription = input.job.description ? stripHtml(input.job.description) : 'No job description provided.'
  const jobQuestions = normalizeQuestions(input.job.interview_questions)
  const extraQuestions = jobQuestions.length > 0 ? jobQuestions : []

  // Formatting Lists
  const experienceList = formatExperience(Array.isArray(parsedData?.experience) ? parsedData.experience : [])
  const strengthList = strengths.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('')
  const concernList = concerns.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('')

  const logoHtml = input.logoUrl
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${input.logoUrl}" style="height: 60px;" /></div>`
    : '<div style="text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 20px;">THE ANCHOR</div>'

  // Styles for PDF
  const styles = `
        <style>
            @page { margin: 10mm; size: A4; }
            body { font-family: 'Helvetica', 'Arial', sans-serif; color: #111827; line-height: 1.4; font-size: 12px; }
            h1 { font-size: 18px; margin: 0 0 10px; border-bottom: 2px solid #111827; padding-bottom: 5px; }
            h2 { font-size: 14px; margin: 15px 0 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 2px; }
            p { margin: 0 0 8px; }
            ul { margin: 0 0 8px 18px; padding: 0; }
            li { margin-bottom: 4px; }
            
            .page-break { page-break-before: always; }
            .section { margin-bottom: 15px; }
            .grid-2 { display: table; width: 100%; border-spacing: 10px 0; margin: 0 -10px; }
            .col { display: table-cell; vertical-align: top; width: 50%; }
            
            .meta-row { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 5px; font-weight: bold; font-size: 14px; }
            
            .question-block { margin-bottom: 15px; page-break-inside: avoid; }
            .question-text { font-weight: bold; margin-bottom: 5px; }
            .write-line { border-bottom: 1px solid #000; height: 18px; margin-top: 15px; }
            .write-line-dotted { border-bottom: 1px dotted #9ca3af; height: 18px; margin-top: 15px; }
            
            .sub-questions { margin-left: 20px; margin-top: 5px; }
            .sub-q { margin-bottom: 5px; }
            
            .header-logo { text-align: center; margin-bottom: 20px; }
            .header-logo img { height: 50px; }
        </style>
    `

  // PAGE 1: AI & Application Summary
  const page1 = `
        <div class="header-logo">
            ${input.logoUrl ? `<img src="${input.logoUrl}" />` : '<h1>THE ANCHOR</h1>'}
        </div>
        
        <h1>Candidate Insight: ${escapeHtml(candidateName)}</h1>
        <p style="color: #6b7280; margin-bottom: 15px;">Applied for: <strong>${escapeHtml(input.job.title)}</strong> | Email: ${escapeHtml(input.candidate.email)} | Phone: ${escapeHtml(input.candidate.phone)}</p>

        <div class="section">
            <h2>AI Screening Summary</h2>
            <p>${escapeHtml(summary)}</p>
        </div>

        <div class="grid-2">
            <div class="col">
                <h2>Strengths</h2>
                ${strengthList ? `<ul>${strengthList}</ul>` : '<p>No specific strengths noted.</p>'}
            </div>
            <div class="col">
                <h2>Concerns / Questions</h2>
                ${concernList ? `<ul>${concernList}</ul>` : '<p>No specific concerns noted.</p>'}
            </div>
        </div>

        <div class="section">
            <h2>Experience Highlights</h2>
            <ul>${experienceList}</ul>
        </div>
        
        <div class="section">
             <h2>Job Description Match (Context)</h2>
             <p style="font-size: 10px; color: #6b7280;">${escapeHtml(jobDescription).slice(0, 500)}...</p>
        </div>
    `

  // PAGE 2: The Interview Form (Matches Image)
  const page2 = `
        <div class="page-break"></div>
        
        <div class="header-logo">
            ${input.logoUrl ? `<img src="${input.logoUrl}" />` : '<h1>THE ANCHOR</h1>'}
        </div>

        <div class="meta-row">
            <div>Name: ${escapeHtml(candidateName)}</div>
            <div>Date of Interview: ____________________________</div>
        </div>

        <div class="question-block">
            <div class="question-text">What experience do you have that would be relevant here at The Anchor?</div>
            <div class="write-line"></div>
            <div class="write-line"></div>
            <div class="write-line"></div>
        </div>
        
        <div style="margin-top: 20px; margin-bottom: 10px; font-weight: bold; text-decoration: underline;">Questions</div>

        ${ANCHOR_QUESTIONS.map((q, i) => {
    if (typeof q === 'string') {
      return `
                <div class="question-block">
                    <div class="question-text">${i + 1}. ${escapeHtml(q)}</div>
                    <div class="write-line"></div>
                </div>
                `
    } else {
      return `
                <div class="question-block">
                    <div class="question-text">${i + 1}. ${escapeHtml(q.question)}</div>
                    <div class="sub-questions">
                        ${q.subQuestions.map(sq => `<div class="sub-q">${sq}</div>`).join('')}
                    </div>
                </div>
                `
    }
  }).join('')}

        ${extraQuestions.length > 0 ? `
            <div style="margin-top: 20px; margin-bottom: 10px; font-weight: bold; text-decoration: underline;">Job Specific Questions</div>
            ${extraQuestions.map((q, i) => `
                <div class="question-block">
                    <div class="question-text">${ANCHOR_QUESTIONS.length + i + 1}. ${escapeHtml(q)}</div>
                    <div class="write-line"></div>
                </div>
            `).join('')}
        ` : ''}

        <div class="question-block" style="margin-top: 20px;">
            <div class="question-text">Notes / Outcome</div>
            <div class="write-line-dotted"></div>
            <div class="write-line-dotted"></div>
            <div class="write-line-dotted"></div>
            <div class="write-line-dotted"></div>
        </div>
    `

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Interview - ${escapeHtml(candidateName)}</title>
        ${styles}
      </head>
      <body>
        ${page1}
        ${page2}
      </body>
    </html>
  `
}
