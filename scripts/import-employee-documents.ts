#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptMutationAllowed,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'import-employee-documents'
const RUN_MUTATION_ENV = 'RUN_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION_SCRIPT'
const HARD_CAP = 500

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

type DocType = 'payslip' | 'p45' | 'p60'

type CandidateMatch = {
  filePath: string
  relativePath: string
  fileName: string
  extension: string
  docType: DocType | null
  categoryName: string | null
  firstInitial: string | null
  lastName: string | null
  employeeId: string | null
  employeeName: string | null
  status: 'ready' | 'skipped' | 'ambiguous'
  reason: string
}

type EmployeeLookup = {
  employee_id: string
  first_name: string
  last_name: string
  email_address: string | null
}

const DEFAULT_CATEGORY_MAP: Record<DocType, string> = {
  payslip: 'Payslip',
  p45: 'P45',
  p60: 'P60',
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.tif',
  '.tiff',
  '.jpg',
  '.jpeg',
  '.png',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

const MONTH_TOKENS = new Set([
  'jan', 'january',
  'feb', 'february',
  'mar', 'march',
  'apr', 'april',
  'may',
  'jun', 'june',
  'jul', 'july',
  'aug', 'august',
  'sep', 'sept', 'september',
  'oct', 'october',
  'nov', 'november',
  'dec', 'december',
])

const IGNORE_TOKENS = new Set([
  'pays',
  'payslip',
  'payslips',
  'p45',
  'p60',
  'part',
])

function normalizeLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function extractFirstInitial(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = normalizeLetters(value)
  return cleaned ? cleaned[0] : null
}

function sanitizeFileName(name: string, fallback: string): string {
  const sanitized = name
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')

  return sanitized || fallback
}

function detectDocType(baseName: string): { docType: DocType | null; matchIndex: number } {
  const lower = baseName.toLowerCase()

  const p45 = /\bp45\b/.exec(lower)
  if (p45?.index !== undefined) {
    return { docType: 'p45', matchIndex: p45.index }
  }

  const p60 = /\bp60\b/.exec(lower)
  if (p60?.index !== undefined) {
    return { docType: 'p60', matchIndex: p60.index }
  }

  const payslip = /\bpayslips?\b/.exec(lower)
  if (payslip?.index !== undefined) {
    return { docType: 'payslip', matchIndex: payslip.index }
  }

  const pays = /\bpays\b/.exec(lower)
  if (pays?.index !== undefined) {
    return { docType: 'payslip', matchIndex: pays.index }
  }

  return { docType: null, matchIndex: -1 }
}

function parseNameFromPart(part: string): { firstInitial: string | null; lastName: string | null } {
  const tokens = part
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(token => token.replace(/[^a-zA-Z'\-]/g, ''))
    .filter(Boolean)
    .map(token => token.toLowerCase())
    .filter(token => !MONTH_TOKENS.has(token))
    .filter(token => !IGNORE_TOKENS.has(token))
    .filter(token => !/^\d+$/.test(token))

  if (tokens.length < 2) {
    return { firstInitial: null, lastName: null }
  }

  const firstInitial = extractFirstInitial(tokens[0])
  const lastName = tokens.slice(1).join(' ')

  if (!firstInitial || !lastName) {
    return { firstInitial: null, lastName: null }
  }

  return { firstInitial, lastName }
}

function extractName(baseName: string, docType: DocType, matchIndex: number): { firstInitial: string | null; lastName: string | null } {
  const prefix = baseName.slice(0, matchIndex).trim()
  const suffix = baseName.slice(matchIndex + docType.length).trim()

  const primary = parseNameFromPart(prefix)
  if (primary.firstInitial && primary.lastName) {
    return primary
  }

  if (docType !== 'payslip') {
    const secondary = parseNameFromPart(suffix)
    if (secondary.firstInitial && secondary.lastName) {
      return secondary
    }
  }

  return { firstInitial: null, lastName: null }
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath)
      files.push(...nested)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

type ParsedArgs = {
  root: string
  confirm: boolean
  dryRun: boolean
  payslipCategory: string
  p45Category: string
  p60Category: string
  limit: number | null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }
  return parsed
}

function parseArgs(argv: string[]): ParsedArgs {
  const config: ParsedArgs = {
    root: '',
    confirm: false,
    dryRun: true,
    payslipCategory: DEFAULT_CATEGORY_MAP.payslip,
    p45Category: DEFAULT_CATEGORY_MAP.p45,
    p60Category: DEFAULT_CATEGORY_MAP.p60,
    limit: null,
  }

  let wantsDryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--confirm' || arg === '--commit') {
      config.confirm = true
      continue
    }

    if (arg === '--dry-run') {
      wantsDryRun = true
      continue
    }

    if (arg.startsWith('--root=')) {
      config.root = arg.split('=')[1] || ''
      continue
    }

    if (arg === '--root') {
      config.root = argv[i + 1] || ''
      i += 1
      continue
    }

    if (arg.startsWith('--payslip-category=')) {
      config.payslipCategory = arg.split('=')[1] || config.payslipCategory
      continue
    }

    if (arg.startsWith('--p45-category=')) {
      config.p45Category = arg.split('=')[1] || config.p45Category
      continue
    }

    if (arg.startsWith('--p60-category=')) {
      config.p60Category = arg.split('=')[1] || config.p60Category
      continue
    }

    if (arg.startsWith('--limit=')) {
      config.limit = parsePositiveInt(arg.split('=')[1] ?? null)
      continue
    }

    if (arg === '--limit') {
      config.limit = parsePositiveInt(argv[i + 1] ?? null)
      i += 1
      continue
    }
  }

  config.dryRun = wantsDryRun || !config.confirm
  return config
}

async function main() {
  const config = parseArgs(process.argv.slice(2))

  console.log(`[${SCRIPT_NAME}] ${config.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!config.root) {
    throw new Error(`[${SCRIPT_NAME}] Missing --root path`)
  }

  if (!config.dryRun) {
    if (!config.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (config.limit === null) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
    }
    if (config.limit > HARD_CAP) {
      throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
    }
    if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
      )
    }

    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
  }

  const scanLimit = config.limit ?? Number.POSITIVE_INFINITY

  const root = path.resolve(config.root)
  const admin = createAdminClient()

  const { data: employees, error: employeeError } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address')

  const employeeRows = assertScriptQuerySucceeded({
    operation: 'Load employees',
    error: employeeError,
    data: employees as EmployeeLookup[] | null,
  })

  const employeeIndex = new Map<string, Map<string, EmployeeLookup[]>>()
  for (const employee of employeeRows as EmployeeLookup[]) {
    const lastKey = normalizeLetters(employee.last_name || '')
    const firstInitial = extractFirstInitial(employee.first_name)
    if (!lastKey || !firstInitial) continue

    if (!employeeIndex.has(lastKey)) {
      employeeIndex.set(lastKey, new Map())
    }

    const initialMap = employeeIndex.get(lastKey)!
    const list = initialMap.get(firstInitial) || []
    list.push(employee)
    initialMap.set(firstInitial, list)
  }

  const { data: categories, error: categoryError } = await admin
    .from('attachment_categories')
    .select('category_id, category_name')

  const categoryRows = assertScriptQuerySucceeded({
    operation: 'Load attachment_categories',
    error: categoryError,
    data: categories as Array<{ category_id: string; category_name: string }> | null,
  })

  const categoryMap = new Map<string, { id: string; name: string }>()
  for (const category of categoryRows as { category_id: string; category_name: string }[]) {
    categoryMap.set(normalizeLetters(category.category_name), {
      id: category.category_id,
      name: category.category_name,
    })
  }

  const categoryConfig: Record<DocType, string> = {
    payslip: config.payslipCategory,
    p45: config.p45Category,
    p60: config.p60Category,
  }

  const allFiles = await collectFiles(root)
  const sortedFiles = allFiles.sort()

  const candidates: CandidateMatch[] = []

  for (const filePath of sortedFiles) {
    if (candidates.length >= scanLimit) break
    const extension = path.extname(filePath).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) continue

    const baseName = path.basename(filePath, extension)
    const relativePath = path.relative(root, filePath)

    const { docType, matchIndex } = detectDocType(baseName)
    if (!docType) {
      candidates.push({
        filePath,
        relativePath,
        fileName: path.basename(filePath),
        extension,
        docType: null,
        categoryName: null,
        firstInitial: null,
        lastName: null,
        employeeId: null,
        employeeName: null,
        status: 'skipped',
        reason: 'Unrecognized document type',
      })
      continue
    }

    const { firstInitial, lastName } = extractName(baseName, docType, matchIndex)
    if (!firstInitial || !lastName) {
      candidates.push({
        filePath,
        relativePath,
        fileName: path.basename(filePath),
        extension,
        docType,
        categoryName: categoryConfig[docType],
        firstInitial: firstInitial ?? null,
        lastName: lastName ?? null,
        employeeId: null,
        employeeName: null,
        status: 'skipped',
        reason: 'Unable to extract name',
      })
      continue
    }

    const lastKey = normalizeLetters(lastName)
    const initialMap = employeeIndex.get(lastKey)
    const matches = initialMap?.get(firstInitial) || []

    if (matches.length === 0) {
      candidates.push({
        filePath,
        relativePath,
        fileName: path.basename(filePath),
        extension,
        docType,
        categoryName: categoryConfig[docType],
        firstInitial,
        lastName,
        employeeId: null,
        employeeName: null,
        status: 'skipped',
        reason: 'No employee match',
      })
      continue
    }

    if (matches.length > 1) {
      const names = matches.map(match => `${match.first_name} ${match.last_name}`).join('; ')
      candidates.push({
        filePath,
        relativePath,
        fileName: path.basename(filePath),
        extension,
        docType,
        categoryName: categoryConfig[docType],
        firstInitial,
        lastName,
        employeeId: null,
        employeeName: null,
        status: 'ambiguous',
        reason: `Multiple matches: ${names}`,
      })
      continue
    }

    const match = matches[0]
    candidates.push({
      filePath,
      relativePath,
      fileName: path.basename(filePath),
      extension,
      docType,
      categoryName: categoryConfig[docType],
      firstInitial,
      lastName,
      employeeId: match.employee_id,
      employeeName: `${match.first_name} ${match.last_name}`,
      status: 'ready',
      reason: 'Ready to import',
    })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.mkdir(path.resolve('temp'), { recursive: true })
  const previewJson = path.resolve('temp', `employee-document-import-preview-${timestamp}.json`)
  const previewCsv = path.resolve('temp', `employee-document-import-preview-${timestamp}.csv`)

  await fs.writeFile(previewJson, JSON.stringify(candidates, null, 2), 'utf-8')

  const csvHeader = [
    'status',
    'docType',
    'categoryName',
    'fileName',
    'relativePath',
    'employeeName',
    'employeeId',
    'firstInitial',
    'lastName',
    'reason',
  ]
  const csvRows = candidates.map(candidate => [
    candidate.status,
    candidate.docType ?? '',
    candidate.categoryName ?? '',
    candidate.fileName,
    candidate.relativePath,
    candidate.employeeName ?? '',
    candidate.employeeId ?? '',
    candidate.firstInitial ?? '',
    candidate.lastName ?? '',
    candidate.reason.replace(/\s+/g, ' '),
  ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))

  await fs.writeFile(previewCsv, [csvHeader.join(','), ...csvRows].join('\n'), 'utf-8')

  const summary = candidates.reduce(
    (acc, candidate) => {
      acc.total += 1
      acc[candidate.status] += 1
      return acc
    },
    { total: 0, ready: 0, skipped: 0, ambiguous: 0 }
  )

  console.log('Preview generated.')
  console.log(`Total files scanned: ${summary.total}`)
  console.log(`Ready to import: ${summary.ready}`)
  console.log(`Skipped: ${summary.skipped}`)
  console.log(`Ambiguous: ${summary.ambiguous}`)
  console.log(`Preview JSON: ${previewJson}`)
  console.log(`Preview CSV: ${previewCsv}`)

  if (config.dryRun) {
    console.log('DRY RUN only. Re-run with --confirm to import.')
    return
  }

  const bucket = 'employee-attachments'
  const importTargets = candidates.filter(candidate => candidate.status === 'ready' && candidate.employeeId && candidate.docType)
  const results: Array<{ filePath: string; status: 'imported' | 'failed'; reason?: string; storagePath?: string; employeeId?: string }> = []

  for (const candidate of importTargets) {
    const categoryName = candidate.categoryName ? normalizeLetters(candidate.categoryName) : ''
    const category = categoryMap.get(categoryName)

    if (!category) {
      results.push({ filePath: candidate.filePath, status: 'failed', reason: `Missing category: ${candidate.categoryName}` })
      continue
    }

    const extension = candidate.extension.toLowerCase()
    const mimeType = MIME_BY_EXTENSION[extension] || 'application/octet-stream'

    try {
      const fileBuffer = await fs.readFile(candidate.filePath)
      const sanitizedFileName = sanitizeFileName(candidate.fileName, `document${extension || ''}`)
      const uniqueFileName = `${candidate.employeeId}/${Date.now()}_${sanitizedFileName}`

      const { data: uploadData, error: uploadError } = await admin.storage
        .from(bucket)
        .upload(uniqueFileName, fileBuffer, { upsert: false, contentType: mimeType })

      if (uploadError || !uploadData?.path) {
        results.push({ filePath: candidate.filePath, status: 'failed', reason: uploadError?.message || 'Upload failed' })
        continue
      }

      const { error: insertError } = await admin.from('employee_attachments').insert({
        employee_id: candidate.employeeId,
        category_id: category.id,
        file_name: candidate.fileName,
        storage_path: uploadData.path,
        mime_type: mimeType,
        file_size_bytes: fileBuffer.length,
        description: null,
      })

      if (insertError) {
        const { error: removeError } = await admin.storage.from(bucket).remove([uploadData.path])
        const suffix = removeError ? ` (cleanup failed: ${removeError.message || 'unknown error'})` : ''
        results.push({
          filePath: candidate.filePath,
          status: 'failed',
          reason: `${insertError.message}${suffix}`,
        })
        continue
      }

      results.push({
        filePath: candidate.filePath,
        status: 'imported',
        storagePath: uploadData.path,
        employeeId: candidate.employeeId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      results.push({ filePath: candidate.filePath, status: 'failed', reason: message })
    }
  }

  const resultsJson = path.resolve('temp', `employee-document-import-results-${timestamp}.json`)
  await fs.writeFile(resultsJson, JSON.stringify(results, null, 2), 'utf-8')

  const importedCount = results.filter(result => result.status === 'imported').length
  const failedCount = results.filter(result => result.status === 'failed').length

  console.log('Import complete.')
  console.log(`Imported: ${importedCount}`)
  console.log(`Failed: ${failedCount}`)
  console.log(`Results JSON: ${resultsJson}`)

  if (failedCount > 0) {
    const failures = results
      .filter((result) => result.status === 'failed')
      .map((result) => `${result.filePath}: ${result.reason || 'failed'}`)
    assertScriptCompletedWithoutFailures({ scriptName: SCRIPT_NAME, failureCount: failedCount, failures })
  }
}

main().catch((error) => {
  console.error('Import failed:', error)
  process.exitCode = 1
})
