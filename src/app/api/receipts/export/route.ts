import { NextRequest, NextResponse } from 'next/server'
import archiver, { type ArchiverError } from 'archiver'
import { PassThrough } from 'stream'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { createClient } from '@/lib/supabase/server'
import { receiptQuarterExportSchema } from '@/lib/validation'
import { appendOjProjectInvoices, loadOjProjectInvoicesPaidInQuarter } from '@/lib/receipts/export/oj-project-invoices'
import {
  buildQuarterMileageFiles,
  buildExpensesCsv,
  buildMgdCsv,
  appendExpenseImages,
  appendClaimSummaryPdf,
} from '@/lib/receipts/export'
import {
  buildExportManifest,
  buildManifestCsv,
  buildMissingFilesText,
  buildReceiptsSummaryCsv,
  manifestFingerprint,
  type ExportPayment,
  type MissingFile,
} from '@/lib/receipts/export/manifest'

export const runtime = 'nodejs'
export const maxDuration = 300

const RECEIPT_BUCKET = 'receipts'
const DOWNLOAD_CONCURRENCY = 4

type AdminClient = ReturnType<typeof createAdminClient>
type QuarterRange = { startDate: string; endDate: string }

/**
 * The quarter's payments with their files, read in pages on a unique order. One request returns
 * at most 1,000 rows and says nothing when it stops there, so the unpaged read this replaces
 * would have shipped a short pack for a busy quarter.
 */
async function loadQuarterPayments(supabase: AdminClient, range: QuarterRange): Promise<ExportPayment[]> {
  return fetchAllRows<ExportPayment>(
    (from, to) =>
      supabase
        .from('receipt_transactions')
        .select('*, receipt_files(*)')
        .gte('transaction_date', range.startDate)
        .lte('transaction_date', range.endDate)
        .order('transaction_date', { ascending: false })
        .order('details', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'receipt transactions for export' }
  )
}

/** The ids of the quarter's payments and files, read again to see that nothing moved. */
async function loadQuarterFingerprint(supabase: AdminClient, range: QuarterRange): Promise<string> {
  const rows = await fetchAllRows<{ id: string; receipt_files: Array<{ id: string }> | null }>(
    (from, to) =>
      supabase
        .from('receipt_transactions')
        .select('id, receipt_files(id)')
        .gte('transaction_date', range.startDate)
        .lte('transaction_date', range.endDate)
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'receipt transactions for the export re-check' }
  )
  return manifestFingerprint(rows)
}

export async function GET(request: NextRequest) {
  try {
    const canExport = await checkUserPermission('receipts', 'export')
    if (!canExport) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year'))
    const quarter = Number(url.searchParams.get('quarter'))

    const parsed = receiptQuarterExportSchema.safeParse({ year, quarter })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid export parameters'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const period = { year: parsed.data.year, quarter: parsed.data.quarter }
    const range = deriveQuarterRange(period.year, period.quarter)
    const { startDate, endDate } = range

    // Super admins also get the expenses and MGD CSVs, expense receipt images and the claim
    // summary PDF. The mileage files follow mileage.view instead (spec 6.4).
    const [actor, canViewOjProjects, canViewMileage] = await Promise.all([
      loadExportActor(),
      checkUserPermission('oj_projects', 'view'),
      checkUserPermission('mileage', 'view'),
    ])
    const isSuperAdmin = actor.isSuperAdmin

    const supabase = createAdminClient()

    // The manifest: everything this pack will ship, read once. The summary and the files are
    // both built from it, so they cannot disagree.
    let payments: ExportPayment[]
    try {
      payments = await loadQuarterPayments(supabase, range)
    } catch (error) {
      console.error('Failed to fetch receipt transactions for export:', error)
      return NextResponse.json({ error: 'Failed to load transactions for export.' }, { status: 500 })
    }
    const manifest = buildExportManifest(payments)

    // Mileage files come from one dataset call, before any receipt downloads. A failure throws, so
    // the whole pack fails rather than leaving mileage out (spec 6.4).
    const mileageFiles = canViewMileage
      ? await buildQuarterMileageFiles(supabase, period.year, period.quarter as 1 | 2 | 3 | 4)
      : null

    const ojProjectInvoices = canViewOjProjects
      ? await loadOjProjectInvoicesPaidInQuarter(supabase, startDate, endDate)
      : []

    const archive = archiver('zip', { zlib: { level: 1 } })
    const passthrough = new PassThrough()

    archive.on('warning', (warning) => {
      const archiverWarning = warning as ArchiverError
      if (archiverWarning?.code === 'ENOENT') {
        console.warn('Archiver warning:', warning)
        return
      }
      console.error('Archiver warning (non-ENOENT):', warning)
    })
    archive.on('error', (error) => {
      console.error('Receipts export archive error:', error)
    })

    archive.pipe(passthrough)

    // Collect chunks as they arrive to avoid backpressure deadlock
    const chunks: Buffer[] = []
    passthrough.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    const streamDone = new Promise<void>((resolve, reject) => {
      passthrough.on('end', resolve)
      passthrough.on('error', reject)
    })

    // Every file in the manifest is either added to the pack or recorded as missing. A file that
    // could not be read used to be skipped with a console warning and nothing else.
    const missing: MissingFile[] = []
    const downloadTasks = manifest.files.map((file) => async () => {
      try {
        const download = await supabase.storage.from(RECEIPT_BUCKET).download(file.storagePath)
        if (download.error || !download.data) {
          console.error(`Failed to download receipt ${file.storagePath}:`, download.error)
          missing.push({ file, reason: download.error?.message || 'The file is not in storage.' })
          return
        }
        const buffer = await normaliseToBuffer(download.data)
        if (!buffer.length) {
          missing.push({ file, reason: 'The stored file is empty.' })
          return
        }
        archive.append(buffer, { name: file.zipPath })
      } catch (error) {
        console.error(`Failed to download receipt ${file.storagePath}:`, error)
        missing.push({ file, reason: error instanceof Error ? error.message : 'The file could not be read.' })
      }
    })

    await runWithConcurrency(downloadTasks, DOWNLOAD_CONCURRENCY)

    await appendOjProjectInvoices(archive, ojProjectInvoices, {
      year: period.year,
      quarter: period.quarter,
      startDate,
      endDate,
    })

    if (mileageFiles) {
      archive.append(mileageFiles.csv.content, { name: mileageFiles.csv.name })
      archive.append(mileageFiles.pdf.content, { name: mileageFiles.pdf.name })
    }

    // --- Enhanced bundle for super_admin users ---
    const missingExpenseImages: Array<{ name: string; reason: string }> = []
    if (isSuperAdmin) {
      const q = period.quarter as 1 | 2 | 3 | 4
      const y = period.year

      // Generate expenses and MGD CSVs in parallel
      const [expensesResult, mgdResult] = await Promise.all([
        buildExpensesCsv(supabase, startDate, endDate, y, q),
        buildMgdCsv(supabase, y, q),
      ])

      // Append CSVs to archive
      archive.append(expensesResult.csv, {
        name: `Expenses_Q${q}_${y}.csv`,
      })
      archive.append(mgdResult.csv, {
        name: mgdResult.fileName,
      })

      // Append expense receipt images using the same IDs from the CSV generation
      // to ensure CSV and images represent the same snapshot of data
      const expenseImageCount = await appendExpenseImages(supabase, expensesResult.summary.expenseIds, archive, {
        onMissing: (name, reason) => missingExpenseImages.push({ name, reason }),
      })

      // Generate and append Claim Summary PDF
      await appendClaimSummaryPdf(archive, {
        year: y,
        quarter: q,
        mileage: mileageFiles?.summary ?? null,
        expenses: expensesResult.summary,
        mgd: mgdResult.summary,
        mgdFileName: mgdResult.fileName,
        hasExpenseImages: expenseImageCount > 0,
        expenseRows: expensesResult.rows,
        mgdRows: mgdResult.rows,
      })
    }

    // Still the quarter that was read at the start? A payment added, removed or given a file
    // while the pack was being built would make the summary and the files disagree.
    let fingerprintNow: string
    try {
      fingerprintNow = await loadQuarterFingerprint(supabase, range)
    } catch (error) {
      console.error('Failed to re-check the quarter before finishing the export:', error)
      archive.abort()
      return NextResponse.json({ error: 'Failed to load transactions for export.' }, { status: 500 })
    }
    if (fingerprintNow !== manifestFingerprint(payments)) {
      archive.abort()
      return NextResponse.json(
        { error: 'The quarter changed while the pack was being built. Please try again.' },
        { status: 409 }
      )
    }

    const now = new Date()
    archive.append(buildReceiptsSummaryCsv(manifest, period, { now, missing }), {
      name: `Receipts_Q${period.quarter}_${period.year}.csv`,
    })
    if (manifest.payments.length > 0) {
      archive.append(buildManifestCsv(manifest, period, { now, missing }), { name: 'MANIFEST.csv' })
    }
    if (missing.length > 0 || missingExpenseImages.length > 0) {
      let text = missing.length > 0 ? buildMissingFilesText(missing, period) : ''
      if (missingExpenseImages.length > 0) {
        text += `${text ? '\n' : ''}Expense receipt images that could not be included:\n`
        text += missingExpenseImages.map((image) => `- ${image.name}\n    why: ${image.reason}`).join('\n')
        text += '\n'
      }
      archive.append(Buffer.from(text, 'utf-8'), { name: 'MISSING_FILES.txt' })
    }

    if (!payments.length && !ojProjectInvoices.length && !isSuperAdmin && !mileageFiles) {
      const placeholder = Buffer.from('No transactions found for this quarter.', 'utf-8')
      archive.append(placeholder, { name: 'README.txt' })
    }

    await archive.finalize()
    await streamDone

    const zipBuffer = Buffer.concat(chunks)

    // One entry for the pack: who took it, for which quarter, and what it held.
    try {
      await logAuditEvent({
        user_id: actor.userId ?? undefined,
        user_email: actor.email ?? undefined,
        operation_type: 'export',
        resource_type: 'receipts_quarter_pack',
        resource_id: `${period.year}-Q${period.quarter}`,
        operation_status: 'success',
        additional_info: {
          year: period.year,
          quarter: period.quarter,
          transactions: manifest.payments.length,
          files_listed: manifest.files.length,
          files_included: manifest.files.length - missing.length,
          files_missing: missing.length,
          expense_images_missing: missingExpenseImages.length,
          oj_project_invoices: ojProjectInvoices.length,
          included_mileage: Boolean(mileageFiles),
          included_claim_summary: isSuperAdmin,
          bytes: zipBuffer.length,
        },
      })
    } catch (auditError) {
      console.error('Failed to record the receipts export in the audit log:', auditError)
    }

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="receipts_q${period.quarter}_${period.year}.zip"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(zipBuffer.length),
        'X-Receipts-Missing-Files': String(missing.length + missingExpenseImages.length),
      },
    })
  } catch (err) {
    console.error('Receipts export failed:', err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err)
    return NextResponse.json({ error: 'Failed to generate receipts export.' }, { status: 500 })
  }
}

function deriveQuarterRange(year: number, quarter: number): QuarterRange {
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = startMonth + 2
  // The last day of the quarter's last month: day zero of the month after it.
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
  const pad = (value: number) => String(value).padStart(2, '0')

  return {
    startDate: `${year}-${pad(startMonth)}-01`,
    endDate: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  }
}

async function normaliseToBuffer(data: unknown): Promise<Buffer> {
  if (!data) {
    return Buffer.from('')
  }

  if (Buffer.isBuffer(data)) {
    return data
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data)
  }

  if (typeof (data as any).arrayBuffer === 'function') {
    const arrayBuffer = await (data as Blob).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  return Buffer.from(String(data))
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
  if (!tasks.length) return

  const queue = tasks.slice()
  const workerCount = Math.min(limit, queue.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const task = queue.shift()
      if (!task) return
      await task()
    }
  })

  await Promise.all(workers)
}

/**
 * Who is taking the pack, and whether they are a super admin. The cookie-based client says who
 * the user is; their roles are read with the admin client.
 */
async function loadExportActor(): Promise<{ userId: string | null; email: string | null; isSuperAdmin: boolean }> {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return { userId: null, email: null, isSuperAdmin: false }

    const admin = createAdminClient()
    const { data: roles, error } = await admin
      .from('user_roles')
      .select('roles!inner ( name )')
      .eq('user_id', user.id)

    const isSuperAdmin =
      !error &&
      Boolean(roles) &&
      (roles ?? []).some((r) => (r as unknown as { roles: { name: string } }).roles?.name === 'super_admin')

    return { userId: user.id, email: user.email ?? null, isSuperAdmin }
  } catch {
    return { userId: null, email: null, isSuperAdmin: false }
  }
}
