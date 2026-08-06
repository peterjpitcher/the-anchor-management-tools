#!/usr/bin/env tsx

/**
 * One-off importer for two 20 July 2026 Indeed bar applicants (Saffron Lambourne,
 * Carlos Frias). Same design as `import-indeed-applicants-2026-07-19.ts`: one
 * hand-verified record per applicant, calling the shared
 * `createRecruitmentApplication` service so dedupe, CV upload, extraction and AI
 * scoring behave exactly like a normal application.
 *
 * These two CVs sit in the Downloads root rather than a dated subfolder, so
 * RESUME_DIR points there.
 *
 * Safety: dry-run by default. A real import requires --confirm, --limit, and the
 * env guards RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true +
 * ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true.
 *
 * Usage:
 *   npx tsx scripts/import-indeed-applicants-2026-07-20.ts            # dry run
 *   RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true \
 *   ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true \
 *   npx tsx scripts/import-indeed-applicants-2026-07-20.ts --confirm --limit 5
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { createRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import type { RecruitmentSource } from '@/types/recruitment'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'import-indeed-applicants-2026-07-20'
const RUN_MUTATION_ENV = 'RUN_IMPORT_INDEED_APPLICANTS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT'
const HARD_CAP = 50

const RESUME_DIR = '/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads'

const POSTING_BAR = '3218e975-0797-4357-b4f3-5cb9b9b78fd4'
const POSTING_KITCHEN = '63463f4f-b252-4833-b23f-8c81eb07a687'

type Screener = {
  travel?: string
  experience?: string
  longTerm?: string
  weekends?: string
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
  flags?: string[]
}

const APPLICANTS: Applicant[] = [
  {
    file: 'ResumeSaffronLambourne.pdf',
    firstName: 'Saffron', lastName: 'Lambourne',
    email: 'Saffron.Lambourne@gmail.com', phone: '07947436832', location: 'Slough',
    posting: 'bar',
    screener: {
      travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes',
      solo: 'Yes, I have a years experience.',
    },
    flags: ['CV header misspells her surname as "Lamourne"; her email and Indeed profile confirm "Lambourne".'],
  },
  {
    file: 'ResumeCarlosFrias.pdf',
    firstName: 'Carlos', lastName: 'Frias',
    email: 'Carlosfrias2609@gmail.com', phone: '07494 763682', location: 'Stanwell, Surrey',
    posting: 'bar',
    screener: {
      travel: 'Yes',
      experience: 'Between 6 months and a year in a bar at twickenham stadium',
      longTerm: 'Yes long term', weekends: 'Yeah', solo: 'Yes',
    },
    flags: [
      'Age not stated, but A-levels are in progress and college dates run to 2025, so he may be a recent school-leaver. Confirm he is 18+ before rostering late licensed shifts (an under-18 applicant was rejected for this role for that reason).',
      'Bar experience is 6 to 12 months (a beer pourer at Twickenham Stadium), just under the 1-year preferred.',
    ],
  },
]

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
 * Q3/Q4/Q5 have no dedicated column, so they are folded into `cover_note` as a
 * single " · "-separated line (the drawer collapses newlines).
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
    await fs.writeFile(previewPath, JSON.stringify({ applicants: preview }, null, 2), 'utf-8')
    console.log(`[${SCRIPT_NAME}] DRY RUN: would import ${APPLICANTS.length} applicant(s). No DB writes, no OpenAI calls.`)
    preview.forEach(p => console.log(`    - [${p.posting}] ${p.name} <${p.email ?? 'no-email'}> ${p.phone ?? 'no-phone'}`))
    console.log(`[${SCRIPT_NAME}] Preview written: ${previewPath}`)
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm --limit <n> (+ env guards) to import.`)
    return
  }

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
