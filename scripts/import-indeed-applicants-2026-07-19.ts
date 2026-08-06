#!/usr/bin/env tsx

/**
 * One-off importer for the 19 July 2026 Indeed applicant batch (all bar).
 *
 * Same design as `import-indeed-applicants-2026-07.ts`: one hand-verified record
 * per applicant (name, contact details, target posting, Indeed screener answers),
 * calling the shared `createRecruitmentApplication` service so candidate dedupe
 * (email / phone / CV hash), CV upload, text extraction, AI extraction and AI
 * scoring all behave exactly like a normal application.
 *
 * Screener answers map to the columns the candidate drawer renders:
 *   Q1 travel             -> travel_answer               ("Travel:")
 *   Q2 pub/bar experience -> relevant_experience_answer  ("Experience:")
 *   Q3 + Q4 + Q5          -> cover_note                  ("Cover note:")
 * `availability` (jsonb) is deliberately unused (the drawer silently drops any
 * shape other than {raw}/{text}); cover_note is a single " · "-separated line
 * because the drawer markup collapses newlines.
 *
 * Safety: dry-run by default. A real import requires --confirm, --limit, and the
 * env guards RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true +
 * ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true (project convention).
 *
 * Usage:
 *   npx tsx scripts/import-indeed-applicants-2026-07-19.ts            # dry run
 *   RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true \
 *   ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true \
 *   npx tsx scripts/import-indeed-applicants-2026-07-19.ts --confirm --limit 20
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { createRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import type { RecruitmentSource } from '@/types/recruitment'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'import-indeed-applicants-2026-07-19'
const RUN_MUTATION_ENV = 'RUN_IMPORT_INDEED_APPLICANTS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT'
const HARD_CAP = 50

const RESUME_DIR = '/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Resumes 2026-07-19'

const POSTING_BAR = '3218e975-0797-4357-b4f3-5cb9b9b78fd4'
const POSTING_KITCHEN = '63463f4f-b252-4833-b23f-8c81eb07a687'

type Screener = {
  /** Q1: Can you reach TW19 6AQ within ~15 minutes and reliably get home after midnight finishes? */
  travel?: string
  /** Q2: Do you have at least 1 year's pub/bar experience? */
  experience?: string
  /** Q3: Are you seeking long-term employment (not temporary/student work)? */
  longTerm?: string
  /** Q4: Are you available for weekend shifts on a rota basis? */
  weekends?: string
  /** Q5: Are you comfortable working solo and handling cash/card transactions? */
  solo?: string
}

type Applicant = {
  file: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  location: string | null
  posting: 'bar' | 'kitchen'
  screener?: Screener
  /** Verification flags worth a human eye; written to candidate notes. */
  flags?: string[]
}

// ---------------------------------------------------------------------------
// The batch. Contact details are as printed on each CV (cross-checked per CV);
// `location` prefers the applicant's stated Indeed profile location, falling
// back to the CV where Indeed gave none. All applied for Bar Staff.
// ---------------------------------------------------------------------------
const APPLICANTS: Applicant[] = [
  {
    file: 'ResumeAgataMagrowska.pdf',
    firstName: 'Agata', lastName: 'Magrowska',
    email: 'jakubmagrowskiizahs_c2g@indeedemail.com', phone: '+44 7821 731027', location: 'Southall',
    posting: 'bar',
    screener: {
      travel: 'I got 25min by car, I will need parking space for car',
      experience: 'I got more than that',
      longTerm: 'Long term',
      weekends: "I work mon-fri 8:16. Not sure about Fridays, I can't do from 4. Can do from 5.",
      solo: 'I do have a lot of experience in bar.',
    },
    flags: [
      "Email local part is \"jakubmagrowski\" (Jakub Magrowski) but the applicant is Agata Magrowska - likely a relative's Indeed relay address; confirm before emailing, and note the relay may expire.",
      'Weekend availability is constrained: works Mon-Fri 08:00-16:00 and can only start Fridays from 17:00.',
    ],
  },
  {
    file: 'ResumeShinayGreene.pdf',
    firstName: 'Shinay', lastName: 'Greene',
    email: 'shinaygreene7_7iv@indeedemail.com', phone: '+44 7717 251862', location: 'Twickenham',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox, so it may expire.'],
  },
  {
    file: 'ResumeLucasBrannan.pdf',
    firstName: 'Lucas', lastName: 'Brannan',
    email: 'lucasbrannan5_h9j@indeedemail.com', phone: '+44 7935 730466', location: 'Ashford',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox, so it may expire.'],
  },
  {
    file: 'ResumeSamuelPowell.pdf',
    firstName: 'Samuel', lastName: 'Powell',
    email: 'Samuel.b.Powell1988@gmail.com', phone: '07476 780839', location: 'Windsor',
    posting: 'bar',
    screener: {
      travel: 'I can within 30 mins',
      experience: 'I have 13 years in bars and hospitality.',
      longTerm: 'Yes', weekends: 'Yes', solo: 'Yes',
    },
    flags: ['Travel is ~30 minutes, not the ~15 the screener asks about.'],
  },
  {
    file: 'ResumeLoganBathurst.pdf',
    firstName: 'Logan', lastName: 'Bathurst',
    email: 'loganabathurst@outlook.com', phone: '+44 7827 632719', location: 'London',
    posting: 'bar',
    screener: { travel: 'yes', experience: 'yes', longTerm: 'yes', weekends: 'yes', solo: 'yes' },
  },
  {
    file: 'ResumePawelMika.pdf',
    firstName: 'Pawel', lastName: 'Mika',
    email: 'here.comes.mika@gmail.com', phone: '07886 250033', location: 'Chessington',
    posting: 'bar',
    screener: { travel: 'No Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Travel answer is ambiguous ("No Yes"): confirm he can reliably reach TW19 6AQ and get home after midnight.'],
  },
  {
    file: 'ResumeAkshayRallan.pdf',
    firstName: 'Akshay', lastName: 'Rallan',
    email: 'akshayrallan1234@gmail.com', phone: '+44 7513 311755', location: 'London',
    posting: 'bar',
    screener: { travel: 'Yh', experience: 'Yh', longTerm: 'No', weekends: 'Yh', solo: 'Yh' },
    flags: ['Answered No to long-term employment (not seeking permanent work).'],
  },
  {
    file: 'ResumeYasminSilk.pdf',
    firstName: 'Yasmin', lastName: 'Silk',
    email: 'yasminsilk58@gmail.com', phone: '+44 7903 489352', location: null,
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'No', weekends: 'Yes', solo: 'Yes' },
    flags: ['Answered No to long-term employment (not seeking permanent work).'],
  },
  {
    file: 'ResumeCaelanStoker.pdf',
    firstName: 'Caelan', lastName: 'Stoker',
    email: 'caelanstokerumvvt_v5f@indeedemail.com', phone: '+44 7305 583160', location: 'New Malden',
    posting: 'bar',
    screener: {
      travel: "It will be around half an hour. And yes I'll be able to get home.",
      experience: 'Yes.',
      longTerm: "I'm a university student. But my course is 3 years. And I would like to move to London after my course ends.",
      weekends: 'Yes', solo: 'Yes',
    },
    flags: [
      'Email is an Indeed relay address, not a personal inbox, so it may expire.',
      'University student (3-year course); travel ~30 minutes, not ~15.',
    ],
  },
  {
    file: 'ResumeZoeGlover.pdf',
    firstName: 'Zoe', lastName: 'Glover',
    email: 'Glover.z.zoe@gmail.com', phone: '07442425179', location: null,
    posting: 'bar',
    screener: {
      travel: 'It takes me half an hour to get there but I have my own car so can easily make my way back and forth',
      experience: 'Yes',
      longTerm: 'Full employment till I start university in September then move to part time if possible',
      weekends: 'Yes', solo: 'Yes',
    },
    flags: ['Travel ~30 minutes, not ~15. Full-time only until September, then part-time (starting university).'],
  },
  {
    file: 'ResumeLEVIGUMBS.pdf',
    firstName: 'Levi', lastName: 'Gumbs',
    email: 'Levi2.gumbs@live.uwe.ac.uk', phone: '07904564399', location: 'Bracknell',
    posting: 'bar',
    screener: { travel: 'yes', experience: 'yes', longTerm: 'maybe', weekends: 'yes', solo: 'yes' },
    flags: [
      'Email is a University of the West of England address, so it may stop working after he graduates; get a personal address.',
      'Answered "maybe" to long-term employment.',
    ],
  },
  {
    file: 'ResumeJievynGill.pdf',
    firstName: 'Jievyn', lastName: 'Gill',
    email: 'Jievyn@hotmail.com', phone: '07442129546', location: 'Hounslow, UB7',
    posting: 'bar',
    screener: {
      travel: 'Yes', experience: 'Yes',
      longTerm: 'Looking to work during holidays and shifts on weekends.',
      weekends: 'Yes', solo: 'Yes',
    },
    flags: [
      'CV states he is 16 years old (Year 12 student). Under-18 employment in licensed premises has legal restrictions: young-worker hours, and each alcohol sale must be individually approved by a responsible person. Confirm age and check the rules before scheduling any late or post-midnight shifts.',
      'CV is a scanned image with no text layer, so details were read visually and automatic CV text extraction will not populate.',
      'Screener answered "Yes" to 1 year experience, but the CV shows only a 4-month restaurant assistant role.',
      'Long-term answer is really holidays plus weekends only, not permanent full-time.',
    ],
  },
  {
    file: 'ResumeTAUSYLVESTER.pdf',
    firstName: 'Tau', lastName: 'Sylvester',
    email: 'sylvestertau182@gmail.com', phone: '07713895829', location: 'Ealing, London',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Already existed as a June talent-pool record (CV only); this import adds his Bar Staff application, phone number and screener answers.'],
  },
  {
    file: 'ResumePisukaNandakishor.pdf',
    firstName: 'Nanda Kishor', lastName: 'Pisuka',
    email: 'piskanandu966@gmail.com', phone: '07721565371', location: 'London',
    posting: 'bar',
    screener: { travel: '30 minutes', experience: 'Yes', longTerm: 'Long term', weekends: 'Yes', solo: 'Yes' },
    flags: [
      'Name order: Indeed lists "Pisuka Nandakishor" but the CV header reads "Nanda Kishor Pisuka"; imported as Nanda Kishor Pisuka. Confirm.',
      'CV shows IT support and customer-service roles only, no bar or pub work, despite answering "Yes" to 1 year pub/bar experience.',
      'Travel ~30 minutes, not ~15.',
    ],
  },
  {
    file: 'ResumeDemiMcalister.pdf',
    firstName: 'Demi', lastName: 'Mcalister',
    email: 'demimcalistergh9gb_wio@indeedemail.com', phone: '+44 7751 315165', location: 'Egham',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'No', weekends: 'Yes', solo: 'Yes' },
    flags: [
      'Email is an Indeed relay address, not a personal inbox, so it may expire.',
      'No pub/bar experience (university student, hospital-pharmacy and charity-shop background).',
      'Did not answer the long-term-employment screener question.',
    ],
  },
  {
    file: 'ResumeAndreeaFlorea.pdf',
    firstName: 'Andreea', lastName: 'Florea',
    email: 'andreeaflorea050@gmail.com', phone: '+447401820645', location: 'Ashford',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'No', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['No pub/bar experience (customer-service and retail background at Game Nation).'],
  },
  {
    file: 'ResumeSudarsanPandey.pdf',
    firstName: 'Sudarsan', lastName: 'Pandey',
    // CV printed the number as "+44 07345249874" (a spurious 0 after +44);
    // stored as the unambiguous UK national form. Flagged for a human to verify.
    email: 'sudrsnpandey09@gmail.com', phone: '07345249874', location: 'Staines-upon-Thames',
    posting: 'bar',
    screener: { travel: 'yes', experience: 'No', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: [
      'No pub/bar experience (mechanical junior technician background).',
      'CV printed the phone as "+44 07345249874" (an invalid extra 0); stored as 07345249874. Verify the number.',
    ],
  },
]

// Everyone in this batch is new to the ATS except Tau Sylvester, who is handled
// as an update above (a June talent-pool record gains a Bar Staff application),
// so there is nobody to deliberately skip.
const DELIBERATELY_SKIPPED: { name: string; reason: string }[] = []

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }
  return Number(trimmed)
}

type Args = { confirm: boolean; dryRun: boolean; limit: number | null; skipAi: boolean; delayMs: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false, dryRun: true, limit: null, skipAi: false, delayMs: 400 }
  let wantsDryRun = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--confirm' || arg === '--commit') { args.confirm = true; continue }
    if (arg === '--dry-run') { wantsDryRun = true; continue }
    if (arg === '--no-ai') { args.skipAi = true; continue }
    if (arg === '--limit') { args.limit = parsePositiveInt(argv[i + 1] ?? null); i += 1; continue }
    if (arg.startsWith('--limit=')) { args.limit = parsePositiveInt(arg.slice('--limit='.length) ?? null); continue }
  }
  args.dryRun = wantsDryRun || !args.confirm
  return args
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Supabase/provider errors are often plain objects carrying code/details/hint
// rather than Error instances, so a bare `error.message` loses the cause.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const anyErr = error as Record<string, unknown>
    const parts = [error.message || error.name]
    for (const key of ['code', 'status', 'statusCode', 'details', 'hint']) {
      if (anyErr[key] != null) parts.push(`${key}=${String(anyErr[key])}`)
    }
    if (anyErr.cause != null) parts.push(`cause=${describeError(anyErr.cause)}`)
    return parts.filter(Boolean).join(' ')
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const parts: string[] = []
    for (const key of ['message', 'error', 'code', 'status', 'statusCode', 'name', 'details', 'hint']) {
      const value = obj[key]
      if (value != null) parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    }
    return parts.length ? parts.join(' ') : JSON.stringify(obj)
  }
  return String(error)
}

/**
 * Q3/Q4/Q5 have no dedicated column, so they are folded into `cover_note`.
 * Single line, " · " separated: the drawer renders cover_note without
 * `whitespace-pre-wrap`, so newlines would collapse into a run-on paragraph.
 */
function buildCoverNote(screener: Screener | undefined): string | null {
  if (!screener) return null
  const parts: string[] = []
  if (screener.longTerm) parts.push(`Long-term employment: ${screener.longTerm}`)
  if (screener.weekends) parts.push(`Weekend shifts on a rota: ${screener.weekends}`)
  if (screener.solo) parts.push(`Comfortable solo + cash/card: ${screener.solo}`)
  if (parts.length === 0) return null
  return `Indeed screener - ${parts.join(' · ')}`
}

function buildNotes(applicant: Applicant, importedOn: string): string {
  const lines = [`Imported from the Indeed applicant batch on ${importedOn}. Source file: ${applicant.file}.`]
  if (!applicant.screener) lines.push('No Indeed screener answers were provided.')
  for (const flag of applicant.flags ?? []) lines.push(`Check: ${flag}`)
  return lines.join(' ')
}

type ImportResult = {
  file: string
  name: string
  posting: 'bar' | 'kitchen'
  status: 'imported' | 'failed'
  candidateId?: string
  candidateEmail?: string | null
  applicationId?: string
  applicationStatus?: string
  aiScore?: number | null
  aiRecommendation?: string | null
  extractionStatus?: string
  cvExtractionError?: string | null
  scoringError?: string | null
  error?: string
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const bar = APPLICANTS.filter(a => a.posting === 'bar')
  const kitchen = APPLICANTS.filter(a => a.posting === 'kitchen')

  // Fail fast on a bad dataset rather than half-importing it.
  const problems: string[] = []
  const seenFiles = new Set<string>()
  const seenEmails = new Set<string>()
  for (const a of APPLICANTS) {
    if (seenFiles.has(a.file)) problems.push(`duplicate file entry: ${a.file}`)
    seenFiles.add(a.file)
    if (a.email) {
      const key = a.email.toLowerCase()
      if (seenEmails.has(key)) problems.push(`duplicate email: ${a.email}`)
      seenEmails.add(key)
    }
    if (!a.email && !a.phone) problems.push(`${a.file}: neither email nor phone, candidate would be unreachable`)
    const coverNote = buildCoverNote(a.screener)
    if (coverNote && coverNote.length > 12000) problems.push(`${a.file}: cover_note exceeds 12000 chars`)
    if (a.screener?.travel && a.screener.travel.length > 4000) problems.push(`${a.file}: travel_answer exceeds 4000 chars`)
    if (a.screener?.experience && a.screener.experience.length > 4000) problems.push(`${a.file}: relevant_experience_answer exceeds 4000 chars`)
    try {
      await fs.access(path.join(RESUME_DIR, a.file))
    } catch {
      problems.push(`${a.file}: CV file not found in ${RESUME_DIR}`)
    }
  }
  if (problems.length > 0) {
    console.error(`[${SCRIPT_NAME}] dataset validation failed:`)
    problems.forEach(p => console.error(`    - ${p}`))
    throw new Error(`[${SCRIPT_NAME}] ${problems.length} dataset problem(s); nothing was written`)
  }

  console.log(`[${SCRIPT_NAME}] applicants: ${APPLICANTS.length} (bar ${bar.length}, kitchen ${kitchen.length})`)
  console.log(`[${SCRIPT_NAME}] deliberately skipped: ${DELIBERATELY_SKIPPED.length}`)
  DELIBERATELY_SKIPPED.forEach(s => console.log(`    - ${s.name}: ${s.reason}`))
  console.log(`[${SCRIPT_NAME}] AI extraction + scoring: ${args.skipAi ? 'OFF' : 'ON'}`)

  await fs.mkdir(path.resolve('temp'), { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (args.dryRun) {
    const preview = APPLICANTS.map(a => ({
      file: a.file,
      name: `${a.firstName} ${a.lastName}`,
      email: a.email,
      phone: a.phone,
      location: a.location,
      posting: a.posting,
      travel_answer: a.screener?.travel ?? null,
      relevant_experience_answer: a.screener?.experience ?? null,
      cover_note: buildCoverNote(a.screener),
      notes: buildNotes(a, timestamp.slice(0, 10)),
    }))
    const previewPath = path.resolve('temp', `indeed-applicants-import-preview-${timestamp}.json`)
    await fs.writeFile(previewPath, JSON.stringify({ applicants: preview, skipped: DELIBERATELY_SKIPPED }, null, 2), 'utf-8')
    console.log(`[${SCRIPT_NAME}] DRY RUN: would import ${APPLICANTS.length} applicant(s). No DB writes, no OpenAI calls.`)
    preview.forEach(p => console.log(`    - [${p.posting}] ${p.name} <${p.email ?? 'no-email'}> ${p.phone ?? 'no-phone'}`))
    console.log(`[${SCRIPT_NAME}] Preview written: ${previewPath}`)
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm --limit <n> (+ env guards) to import.`)
    return
  }

  // ---- Mutation guards (project convention) ----
  if (!args.confirm) throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  if (args.limit === null) throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  if (args.limit > HARD_CAP) throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  const targets = APPLICANTS.slice(0, args.limit)
  if (APPLICANTS.length > targets.length) {
    console.log(`[${SCRIPT_NAME}] WARNING: ${APPLICANTS.length} applicants but --limit ${args.limit} caps this run to ${targets.length}.`)
  }

  const consentAt = new Date().toISOString()
  const source: RecruitmentSource = 'job_board'
  const results: ImportResult[] = []

  let index = 0
  for (const applicant of targets) {
    index += 1
    const name = `${applicant.firstName} ${applicant.lastName}`
    const filePath = path.join(RESUME_DIR, applicant.file)

    try {
      const buffer = await fs.readFile(filePath)
      const result = await createRecruitmentApplication(
        {
          candidate: {
            first_name: applicant.firstName,
            last_name: applicant.lastName,
            email: applicant.email,
            phone: applicant.phone,
            location: applicant.location,
            source,
            consent_source: 'indeed_application',
            consent_at: consentAt,
            sms_consent: false,
            future_recruitment_consent: false,
            notes: buildNotes(applicant, consentAt.slice(0, 10)),
          },
          job_posting_id: applicant.posting === 'bar' ? POSTING_BAR : POSTING_KITCHEN,
          source,
          cover_note: buildCoverNote(applicant.screener),
          relevant_experience_answer: applicant.screener?.experience ?? null,
          travel_answer: applicant.screener?.travel ?? null,
        },
        {
          cvUpload: {
            buffer,
            fileName: applicant.file,
            mimeType: 'application/pdf',
            sizeBytes: buffer.length,
          },
          uploadKind: 'admin',
          currentUserId: null,
          skipAi: args.skipAi,
        },
      )

      results.push({
        file: applicant.file,
        name,
        posting: applicant.posting,
        status: 'imported',
        candidateId: result.candidate.id,
        candidateEmail: result.candidate.email,
        applicationId: result.application.id,
        applicationStatus: result.application.status,
        aiScore: result.application.ai_score ?? null,
        aiRecommendation: result.application.ai_recommendation ?? null,
        extractionStatus: result.candidate.cv_extraction_status,
        cvExtractionError: result.cvExtractionError,
        scoringError: result.scoringError,
      })

      const flags = [
        `status:${result.application.status}`,
        `extract:${result.candidate.cv_extraction_status}`,
        result.application.ai_score != null ? `score:${result.application.ai_score}` : null,
        result.cvExtractionError ? 'extract-err' : null,
        result.scoringError ? 'score-err' : null,
      ].filter(Boolean).join(' ')
      console.log(`[${SCRIPT_NAME}] [${index}/${targets.length}] OK  [${applicant.posting}] ${name} <${result.candidate.email ?? 'no-email'}> (${flags})`)
    } catch (error) {
      const message = describeError(error)
      results.push({ file: applicant.file, name, posting: applicant.posting, status: 'failed', error: message })
      console.error(`[${SCRIPT_NAME}] [${index}/${targets.length}] FAIL [${applicant.posting}] ${name} -> ${message}`)
    }

    await sleep(args.delayMs)
  }

  const resultsPath = path.resolve('temp', `indeed-applicants-import-results-${timestamp}.json`)
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8')

  const imported = results.filter(r => r.status === 'imported')
  const failed = results.filter(r => r.status === 'failed')
  const duplicates = imported.filter(r => r.applicationStatus === 'declined_duplicate')

  console.log('')
  console.log(`[${SCRIPT_NAME}] imported: ${imported.length}, failed: ${failed.length}, duplicate applications: ${duplicates.length}`)
  console.log(`[${SCRIPT_NAME}] unique candidates: ${new Set(imported.map(r => r.candidateId)).size}`)
  console.log(`[${SCRIPT_NAME}] CV extraction failures: ${imported.filter(r => r.extractionStatus !== 'done').length}`)
  console.log(`[${SCRIPT_NAME}] scoring failures: ${imported.filter(r => r.scoringError).length}`)
  console.log(`[${SCRIPT_NAME}] Results written: ${resultsPath}`)
  if (failed.length > 0) {
    console.error(`[${SCRIPT_NAME}] FAILURES:`)
    failed.forEach(f => console.error(`    - ${f.name}: ${f.error}`))
  }
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
