#!/usr/bin/env tsx

/**
 * Repairs CV text for three candidates from the 19 July 2026 Indeed import
 * whose PDFs defeated the normal `pdf2json` extraction path, then re-runs AI
 * extraction and scoring so their scores reflect their actual CVs.
 *
 * Why they failed:
 *   - Andreea Florea: the PDF has a malformed XRef stream that pdf2json rejects
 *     outright ("Invalid XRef stream"), though poppler reads it cleanly.
 *     Extraction status was left "failed" with empty cv_text, and she scored 30
 *     on the screener answers alone. Her CV shows a night-relief-supervisor role
 *     and customer-service work, so 30 is a tooling floor, not her application.
 *   - Jievyn Gill / Nanda Kishor Pisuka: each PDF is a single scanned image with
 *     no text layer, so pdf2json stored a ~46-character stub and the AI scored
 *     them on the screener answers alone (Jievyn 30, Pisuka 20).
 *
 * The replacement text below is a faithful rendering of what each CV prints:
 * recovered via `pdftotext -layout` for Andreea, and transcribed visually from
 * the scanned images for Jievyn and Pisuka. Nothing is invented. The candidate
 * note records that the text was recovered/transcribed rather than machine-read.
 *
 * Note: repairing does not inflate scores. Pisuka's CV is IT support with no bar
 * work and Jievyn's is a 4-month restaurant role; giving the AI the real text
 * simply makes the score reflect the CV instead of an empty extraction.
 *
 * Safety: dry-run by default. A real run requires --confirm and the env guards
 * RUN_REPAIR_CV_TEXT_MUTATION=true + ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT=true.
 *
 * Usage:
 *   npx tsx scripts/repair-indeed-import-cv-text-2026-07-19.ts
 *   RUN_REPAIR_CV_TEXT_MUTATION=true ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT=true \
 *     npx tsx scripts/repair-indeed-import-cv-text-2026-07-19.ts --confirm
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { rescoreRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'repair-indeed-import-cv-text-2026-07-19'
const RUN_MUTATION_ENV = 'RUN_REPAIR_CV_TEXT_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT'

// Recovered via `pdftotext -layout ResumeAndreeaFlorea.pdf` (poppler reads the
// XRef that pdf2json rejects). Faithful to the printed CV.
const ANDREEA_CV = `ANDREEA ELENA FLOREA
Ashford, Surrey TW15 2UF | +447401820645 | andreeaflorea050@gmail.com

SUMMARY
Dedicated customer service professional with extensive experience in customer relationship management, conflict resolution, and team leadership. Proven track record in call handling, inventory management, and complaint handling. Adept at active listening, problem solving, and time management. Recognised for exceptional customer service skills and the ability to analyse customer feedback effectively. Committed to maintaining high standards of service under pressure while being an adaptive team player with basic computer knowledge.

EXPERIENCE
Customer Service Representative - GAME NATION, Romford, London (08/2025 to Current)
- Addressed customer service enquiries quickly and accurately.
- Maximised customer satisfaction by resolving service issues promptly.
- Managed inbound customer service calls, efficiently resolving queries and complaints.
- Built rapport with customers through courteous and professional communication.
- Maintained accurate records of customer interactions.
- Monitored customer satisfaction metrics and feedback to develop corrective actions.
- Facilitated returns and exchanges in line with company policy.

Night Relief Supervisor - LITTLE VEGAS, Ilford, London (02/2025 to 04/2026)
- Resolved customer complaints swiftly, turning negative experiences into positive outcomes.
- Maintained high standards of cleanliness and organisation in the workplace.
- Oversaw daily operations, ensuring compliance with health and safety regulations.
- Assisted in the recruitment and training of new staff members.
- Managed shift rotas and holiday schedules, maintaining optimal staffing levels.
- Resolved conflicts between team members; led customer-service training sessions.
- Prepared reports on team performance, productivity and sales for senior management.

Warehouse Operator - JAS, Stanwell, Surrey (09/2022 to 01/2023)
- Picked and packed customer orders with accuracy, meeting daily productivity targets.
- Scanned, sorted and diverted packages; maintained compliance with safety standards.
- Processed returned goods and updated inventory records; used handheld scanners.

SKILLS
Customer relationship management; conflict resolution; team leadership; call handling; inventory management; active listening; problem solving; time management; customer feedback analysis; complaint handling; pressure handling; adaptive team player; basic computer knowledge.

EDUCATION
GCSEs: Hair and Beauty - Kingston College, Kingston, London (09/2022 to 06/2024)
Higher National Diploma: Business Marketing - Mont Rose College, Ilford, London (09/2025 to Current)`

// Transcribed visually from the scanned single-image PDF. Faithful to the CV.
const JIEVYN_CV = `JIEVYN GILL
Hounslow, UB7 | 07442129546 | Jievyn@hotmail.com

PROFILE
Motivated and reliable 16-year-old currently studying A-Levels, with strong communication skills and experience in fast-paced customer environments. Confident working with the public, quick to learn, and committed to delivering high-quality service. Looking to contribute to a team while developing further workplace skills.

EXPERIENCE
Restaurant Assistant (4 months)
- Took customer orders and handled front-of-house communication.
- Served food and maintained table cleanliness.
- Supported general cleaning and hygiene tasks.
- Demonstrated teamwork, responsibility, and strong customer interaction skills.
- Learnt to de-escalate situations with high intensity.

EDUCATION
The Langley Academy, Slough (2020-2025)
Year 12 student who has completed GCSEs: Maths, English, Science, BTEC Sport, Geography, French, DT.
Now studying A-Levels at Lampton School: Maths, Economics and Psychology.

SKILLS
Customer service; problem solving; teamwork; time management; ability to work under pressure.`

// Transcribed visually from the scanned single-image PDF. Faithful to the CV.
const PISUKA_CV = `NANDA KISHOR PISUKA
United Kingdom | 07721565371 | piskanandu966@gmail.com

PROFESSIONAL SUMMARY
Motivated and detail-oriented IT and Customer Service professional with experience in providing technical support, troubleshooting, and delivering excellent customer experiences. Skilled in problem-solving, communication, and using IT tools to improve efficiency and customer satisfaction.

WORK EXPERIENCE
IT Support Executive - Tech Solutions Ltd., London, UK (Jan 2022 - Present)
- Provide technical support for hardware, software, and network-related issues.
- Troubleshoot and resolve user queries via phone, email, and remote desktop.
- Install, configure, and maintain computer systems and applications.
- Document issues and solutions in the ticketing system.
- Ensure timely resolution and high customer satisfaction.

Customer Service Representative - Global Connect Services, Hyderabad, India (Aug 2020 - Dec 2021)
- Handled inbound customer inquiries via phone, email, and chat.
- Provided accurate information about products and services.
- Resolved complaints and ensured customer satisfaction.
- Maintained customer records and updated account information.
- Collaborated with teams to improve service quality and response time.

KEY ACHIEVEMENTS
- Consistently maintained high customer satisfaction ratings.
- Successfully resolved complex technical issues within SLA.
- Recognised for excellent communication and problem-solving skills.

EDUCATION
Bachelor of Technology (Information Technology), Jawaharlal Nehru Technological University, India (2017-2021)

CERTIFICATIONS
IT Support Fundamentals (Coursera); Customer Service Training (LinkedIn Learning)

TECHNICAL SKILLS
Operating Systems: Windows 10/11. Tools: MS Office, Outlook, TeamViewer, AnyDesk. Ticketing Systems: Zendesk, Freshdesk. Networking Basics: TCP/IP, DNS, DHCP.

SKILLS
IT Support & Troubleshooting; Customer Service Excellence; Windows & MS Office; Network & Internet Support; CRM & Ticketing Systems; Problem Solving; Communication; Time Management; Adaptability.`

type Repair = {
  name: string
  email: string
  cvText: string
  /** Why the normal extraction path failed, recorded on the candidate. */
  reason: string
}

const REPAIRS: Repair[] = [
  {
    name: 'Andreea Florea',
    email: 'andreeaflorea050@gmail.com',
    cvText: ANDREEA_CV,
    reason: 'CV PDF has a malformed XRef stream that the automatic extractor rejects; CV text was recovered with a different PDF reader on import. Her first AI score of 30 reflected the failed extraction, not her application.',
  },
  {
    name: 'Jievyn Gill',
    email: 'jievyn@hotmail.com',
    cvText: JIEVYN_CV,
    reason: 'CV is a scanned image with no text layer; CV text was transcribed from the document by hand on import. Note the CV states he is 16 years old (see the existing under-18 check).',
  },
  {
    name: 'Nanda Kishor Pisuka',
    email: 'piskanandu966@gmail.com',
    cvText: PISUKA_CV,
    reason: 'CV is a scanned image with no text layer; CV text was transcribed from the document by hand on import. The CV is IT support and customer service, not bar work.',
  },
]

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') return JSON.stringify(error)
  return String(error)
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION' : 'DRY RUN'} starting`)

  const supabase = createAdminClient()

  for (const repair of REPAIRS) {
    const { data: candidate, error } = await supabase
      .from('recruitment_candidates')
      .select('id, first_name, last_name, email, notes, cv_extraction_status, cv_text')
      .eq('email_normalized', repair.email.toLowerCase())
      .maybeSingle()

    if (error) throw error
    if (!candidate) {
      console.error(`[${SCRIPT_NAME}] SKIP ${repair.name}: candidate not found for ${repair.email}`)
      continue
    }

    const { data: apps, error: appsError } = await supabase
      .from('recruitment_applications')
      .select('id, status, ai_score, ai_recommendation')
      .eq('candidate_id', candidate.id)
      .not('job_posting_id', 'is', null)
      .order('created_at', { ascending: false })

    if (appsError) throw appsError
    const application = apps?.[0]
    if (!application) {
      console.error(`[${SCRIPT_NAME}] SKIP ${repair.name}: no scoreable application`)
      continue
    }

    if (!confirm) {
      console.log(`[${SCRIPT_NAME}] DRY RUN ${repair.name}: would replace cv_text (${(candidate.cv_text ?? '').length} -> ${repair.cvText.length} chars), status ${candidate.cv_extraction_status} -> done, then rescore application ${application.id} (currently score ${application.ai_score}, ${application.ai_recommendation}).`)
      continue
    }

    // Clear extracted_data/cv_summary so the rescore path re-derives them from the repaired text.
    const note = `${candidate.notes ?? ''} Check: ${repair.reason}`.trim()
    const { error: updateError } = await supabase
      .from('recruitment_candidates')
      .update({
        cv_text: repair.cvText,
        cv_extraction_status: 'done',
        extracted_data: null,
        cv_summary: null,
        notes: note,
      })
      .eq('id', candidate.id)

    if (updateError) throw updateError

    try {
      const result = await rescoreRecruitmentApplication(application.id, null, supabase)
      console.log(`[${SCRIPT_NAME}] OK  ${repair.name}: ${application.ai_score} (${application.ai_recommendation}) -> ${result.application.ai_score} (${result.application.ai_recommendation})${result.scoringError ? ` scoring-error=${result.scoringError}` : ''}`)
    } catch (rescoreError) {
      console.error(`[${SCRIPT_NAME}] FAIL ${repair.name} rescore: ${describeError(rescoreError)}`)
    }
  }

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm (+ env guards) to apply.`)
    return
  }
  console.log(`[${SCRIPT_NAME}] done`)
}

// ---- Mutation guards (project convention) ----
if (process.argv.includes('--confirm')) {
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
