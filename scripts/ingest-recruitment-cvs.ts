#!/usr/bin/env tsx

/**
 * One-off bulk importer for CV files into the recruitment ATS.
 *
 * For each CV file it calls the existing `createRecruitmentApplication` service,
 * which dedupes the candidate by email, uploads the file to the `recruitment-cvs`
 * bucket, extracts text (pdf2json / mammoth), runs OpenAI structured extraction,
 * and creates a candidate + application row. By default applications are created
 * as a general talent-pool entry (job_posting_id = null, status "new", no scoring).
 *
 * Safety: dry-run by default. A real import requires --confirm, --limit, and the
 * env guards RUN_INGEST_RECRUITMENT_CVS_MUTATION=true +
 * ALLOW_INGEST_RECRUITMENT_CVS_MUTATION_SCRIPT=true (project convention).
 *
 * Usage:
 *   # Preview only (no DB writes, no OpenAI):
 *   npx tsx scripts/ingest-recruitment-cvs.ts --root "/path/to/Resumes & Applications"
 *
 *   # Real import (talent pool, AI extraction on):
 *   RUN_INGEST_RECRUITMENT_CVS_MUTATION=true \
 *   ALLOW_INGEST_RECRUITMENT_CVS_MUTATION_SCRIPT=true \
 *   npx tsx scripts/ingest-recruitment-cvs.ts \
 *     --root "/path/to/Resumes & Applications" \
 *     --extra-file "/path/to/Stray CV.pdf" \
 *     --confirm --limit 300
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { createRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import type { RecruitmentSource } from '@/types/recruitment'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'ingest-recruitment-cvs'
const RUN_MUTATION_ENV = 'RUN_INGEST_RECRUITMENT_CVS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_INGEST_RECRUITMENT_CVS_MUTATION_SCRIPT'
const HARD_CAP = 500

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

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

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw == null || raw === '') return null
  const trimmed = String(raw).trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid non-negative integer: "${raw}"`)
  }
  return Number(trimmed)
}

type Args = {
  root: string
  extraFiles: string[]
  confirm: boolean
  dryRun: boolean
  limit: number | null
  skipAi: boolean
  jobPostingId: string | null
  delayMs: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    root: '',
    extraFiles: [],
    confirm: false,
    dryRun: true,
    limit: null,
    skipAi: false,
    jobPostingId: null,
    delayMs: 200,
  }
  let wantsDryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--confirm' || arg === '--commit') { args.confirm = true; continue }
    if (arg === '--dry-run') { wantsDryRun = true; continue }
    if (arg === '--no-ai') { args.skipAi = true; continue }
    if (arg === '--root') { args.root = argv[i + 1] || ''; i += 1; continue }
    if (arg.startsWith('--root=')) { args.root = arg.slice('--root='.length); continue }
    if (arg === '--extra-file') { if (argv[i + 1]) args.extraFiles.push(argv[i + 1]); i += 1; continue }
    if (arg.startsWith('--extra-file=')) { args.extraFiles.push(arg.slice('--extra-file='.length)); continue }
    if (arg === '--job-posting-id') { args.jobPostingId = argv[i + 1] || null; i += 1; continue }
    if (arg.startsWith('--job-posting-id=')) { args.jobPostingId = arg.slice('--job-posting-id='.length) || null; continue }
    if (arg === '--limit') { args.limit = parsePositiveInt(argv[i + 1] ?? null); i += 1; continue }
    if (arg.startsWith('--limit=')) { args.limit = parsePositiveInt(arg.slice('--limit='.length) ?? null); continue }
    if (arg === '--delay') { args.delayMs = parseNonNegativeInt(argv[i + 1] ?? null) ?? args.delayMs; i += 1; continue }
    if (arg.startsWith('--delay=')) { args.delayMs = parseNonNegativeInt(arg.slice('--delay='.length) ?? null) ?? args.delayMs; continue }
  }

  args.dryRun = wantsDryRun || !args.confirm
  return args
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Surface the real cause instead of a bare "Unknown error". Supabase/provider
// errors are often plain objects (not Error instances) carrying code/details/hint.
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

type IngestResult = {
  file: string
  fileName: string
  status: 'imported' | 'failed'
  candidateId?: string
  candidateName?: string
  candidateEmail?: string | null
  candidateReused?: boolean
  applicationId?: string
  applicationStatus?: string
  extractionStatus?: string
  cvExtractionError?: string | null
  error?: string
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.root && args.extraFiles.length === 0) {
    throw new Error(`[${SCRIPT_NAME}] Provide --root <folder> and/or one or more --extra-file <path>`)
  }

  const root = args.root ? path.resolve(args.root) : process.cwd()

  // Build the candidate file list: everything under --root (if given) plus any --extra-file paths.
  const collected = args.root ? await collectFiles(root) : []
  for (const extra of args.extraFiles) {
    const resolved = path.resolve(extra)
    try {
      const stat = await fs.stat(resolved)
      if (stat.isFile()) collected.push(resolved)
      else console.warn(`[${SCRIPT_NAME}] --extra-file is not a file, skipped: ${resolved}`)
    } catch {
      console.warn(`[${SCRIPT_NAME}] --extra-file not found, skipped: ${resolved}`)
    }
  }

  const seenPaths = new Set<string>()
  const cvFiles = collected
    .filter(filePath => {
      if (seenPaths.has(filePath)) return false
      seenPaths.add(filePath)
      return ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    })
    .sort()

  const byExt = cvFiles.reduce<Record<string, number>>((acc, f) => {
    const ext = path.extname(f).toLowerCase()
    acc[ext] = (acc[ext] ?? 0) + 1
    return acc
  }, {})

  console.log(`[${SCRIPT_NAME}] CV files found: ${cvFiles.length} (${JSON.stringify(byExt)})`)
  console.log(`[${SCRIPT_NAME}] target: ${args.jobPostingId ? `posting ${args.jobPostingId}` : 'talent pool (job_posting_id = null)'}; AI extraction: ${args.skipAi ? 'OFF' : 'ON'}`)

  await fs.mkdir(path.resolve('temp'), { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (args.dryRun) {
    const previewPath = path.resolve('temp', `recruitment-cv-import-preview-${timestamp}.json`)
    await fs.writeFile(
      previewPath,
      JSON.stringify({ root, extraFiles: args.extraFiles, count: cvFiles.length, byExt, files: cvFiles.map(f => path.relative(root, f)) }, null, 2),
      'utf-8',
    )
    console.log(`[${SCRIPT_NAME}] DRY RUN: would ingest ${cvFiles.length} CV file(s). No DB writes, no OpenAI calls.`)
    console.log(`[${SCRIPT_NAME}] Sample (first 10):`)
    cvFiles.slice(0, 10).forEach(f => console.log(`    - ${path.basename(f)}`))
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

  const targets = cvFiles.slice(0, args.limit)
  if (cvFiles.length > targets.length) {
    console.log(`[${SCRIPT_NAME}] WARNING: ${cvFiles.length} files found but --limit ${args.limit} caps this run to ${targets.length}. Re-run to continue (will create new applications only for not-yet-seen emails are NOT deduped per-application — see notes).`)
  }

  const consentAt = new Date().toISOString()
  const source: RecruitmentSource = 'manual_upload'
  const results: IngestResult[] = []
  const seenCandidateIds = new Set<string>()

  let index = 0
  for (const filePath of targets) {
    index += 1
    const fileName = path.basename(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeType = MIME_BY_EXTENSION[ext] || 'application/octet-stream'

    try {
      const buffer = await fs.readFile(filePath)
      const result = await createRecruitmentApplication(
        {
          candidate: {
            source,
            consent_source: 'bulk_import',
            consent_at: consentAt,
            sms_consent: false,
            future_recruitment_consent: false,
            notes: `Imported via bulk CV ingestion (${consentAt.slice(0, 10)}). Source file: ${fileName}`,
          },
          job_posting_id: args.jobPostingId,
          source,
        },
        {
          cvUpload: { buffer, fileName, mimeType, sizeBytes: buffer.length },
          uploadKind: 'admin',
          currentUserId: null,
          skipAi: args.skipAi,
        },
      )

      const candidate = result.candidate
      const reused = seenCandidateIds.has(candidate.id)
      seenCandidateIds.add(candidate.id)
      const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || '(no name extracted)'

      results.push({
        file: filePath,
        fileName,
        status: 'imported',
        candidateId: candidate.id,
        candidateName: name,
        candidateEmail: candidate.email,
        candidateReused: reused,
        applicationId: result.application.id,
        applicationStatus: result.application.status,
        extractionStatus: candidate.cv_extraction_status,
        cvExtractionError: result.cvExtractionError,
      })

      const flags = [
        reused ? 'reused-candidate' : 'new-candidate',
        `extract:${candidate.cv_extraction_status}`,
        result.cvExtractionError ? `extract-err` : null,
      ].filter(Boolean).join(' ')
      console.log(`[${SCRIPT_NAME}] [${index}/${targets.length}] OK  ${fileName} -> ${name} <${candidate.email ?? 'no-email'}> (${flags})`)
    } catch (error) {
      const message = describeError(error)
      results.push({ file: filePath, fileName, status: 'failed', error: message })
      console.error(`[${SCRIPT_NAME}] [${index}/${targets.length}] FAIL ${fileName} -> ${message}`)
    }

    await sleep(args.delayMs)
  }

  // ---- Write results + summary ----
  const resultsPath = path.resolve('temp', `recruitment-cv-import-results-${timestamp}.json`)
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8')

  const imported = results.filter(r => r.status === 'imported')
  const failed = results.filter(r => r.status === 'failed')
  const uniqueCandidates = new Set(imported.map(r => r.candidateId)).size
  const withData = imported.filter(r => r.extractionStatus === 'done').length
  const noData = imported.filter(r => r.extractionStatus !== 'done').length

  console.log('')
  console.log(`[${SCRIPT_NAME}] ===== SUMMARY =====`)
  console.log(`[${SCRIPT_NAME}] Files processed:        ${results.length}`)
  console.log(`[${SCRIPT_NAME}] Applications created:    ${imported.length}`)
  console.log(`[${SCRIPT_NAME}] Unique candidates:      ${uniqueCandidates}`)
  console.log(`[${SCRIPT_NAME}] Extraction done:        ${withData}`)
  console.log(`[${SCRIPT_NAME}] Extraction missing/err: ${noData}`)
  console.log(`[${SCRIPT_NAME}] Hard failures (threw):  ${failed.length}`)
  console.log(`[${SCRIPT_NAME}] Results JSON:           ${resultsPath}`)
  if (failed.length > 0) {
    console.log(`[${SCRIPT_NAME}] First failures:`)
    failed.slice(0, 5).forEach(f => console.log(`    - ${f.fileName}: ${f.error}`))
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
