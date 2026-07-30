import { NextRequest, NextResponse } from 'next/server'

// Puppeteer render path: Node runtime, long budget (spec 3.2, F23; benchmark
// gate F22 may adjust this).
export const runtime = 'nodejs'
export const maxDuration = 300

import { logAuditEvent } from '@/app/actions/audit'
import { requireModulePermission, type PermissionCheckResult } from '@/lib/api/permissions'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { buildVoucherBatchHtml } from '@/lib/voucher-card-template'
import { PDF_PAGES_PER_CARD } from '@/lib/vouchers/constants'
import type {
  TermsClause,
  VoucherBatchRow,
  VoucherEventAction,
  VoucherEventSource,
  VoucherStatus,
} from '@/types/vouchers'

const VOUCHER_BUCKET = 'vouchers'
const SIGNED_URL_TTL_SECONDS = 600
const RENDER_ERROR_MAX_LENGTH = 500

// A serverless invocation that dies mid-render (timeout, out of memory, a deploy
// landing while it runs) leaves pdf_status pinned at 'rendering' with nothing to
// clear it, which would make the batch permanently unrenderable and its numbers
// permanently unissuable. maxDuration is 300s, so a claim older than this is
// certainly dead and can be taken over (spec F51).
const STALE_RENDER_TIMEOUT_MS = 10 * 60 * 1000

// Bounded attempts with a visible error rather than an endless retry loop (F51).
const MAX_RENDER_ATTEMPTS = 5

// Absolutely terminal per the transition matrix (spec 2.5): never reprintable.
const NON_REPRINTABLE_STATUSES: VoucherStatus[] = ['cancelled', 'replaced']

// Overrides the generator's default portrait margins: the card template owns
// the page box (A4 landscape, margin 0, preferCSSPageSize).
const CARD_PDF_OPTIONS = {
  format: 'A4',
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
}

interface BatchVoucherRecord {
  id: string
  voucher_number: string
  type_id: string
  status: VoucherStatus
}

// POST /api/vouchers/batches/[id]/render
// Full render: guards pdf_status in ('pending','failed'), claims 'rendering',
// renders every voucher in the batch, uploads to the immutable path
// batches/{id}/render-{attempt}.pdf and marks the batch 'ready' or 'failed'.
// Reprint: body { voucherNumbers: string[] } renders only that subset, uploads
// to batches/{id}/reprint-{timestamp}.pdf, never touches batch pdf_status, and
// returns a 10-minute signed URL directly.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params

  const auth = await requireModulePermission('vouchers', 'manage')
  if (!auth.ok) return auth.response
  const supabase = auth.supabase

  let voucherNumbers: string[] | null = null
  try {
    const body = (await request.json()) as { voucherNumbers?: unknown }
    if (body && Array.isArray(body.voucherNumbers)) {
      if (!body.voucherNumbers.every((value): value is string => typeof value === 'string' && value.length > 0)) {
        return NextResponse.json(
          { error: 'voucherNumbers must be a list of voucher numbers', code: 'VALIDATION_ERROR' },
          { status: 400 }
        )
      }
      voucherNumbers = body.voucherNumbers
    }
  } catch {
    // No body (or invalid JSON) means a plain full render
  }

  if (voucherNumbers && voucherNumbers.length === 0) {
    return NextResponse.json(
      { error: 'voucherNumbers must not be empty', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const { data: batch, error: batchError } = await supabase
    .from('voucher_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle<VoucherBatchRow>()

  if (batchError) {
    console.error('Failed to load voucher batch for render:', batchError)
    return NextResponse.json({ error: 'Failed to load batch', code: 'RENDER_FAILED' }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const { data: voucherRows, error: vouchersError } = await supabase
    .from('vouchers')
    .select('id, voucher_number, type_id, status')
    .eq('batch_id', batchId)
    .order('voucher_number', { ascending: true })

  if (vouchersError) {
    console.error('Failed to load batch vouchers for render:', vouchersError)
    return NextResponse.json({ error: 'Failed to load vouchers', code: 'RENDER_FAILED' }, { status: 500 })
  }

  const vouchers = (voucherRows ?? []) as BatchVoucherRecord[]
  if (vouchers.length === 0) {
    return NextResponse.json({ error: 'Batch has no vouchers', code: 'RENDER_FAILED' }, { status: 500 })
  }

  const { data: termsRow, error: termsError } = await supabase
    .from('terms_versions')
    .select('version, clauses')
    .eq('version', batch.terms_version)
    .maybeSingle<{ version: string; clauses: TermsClause[] }>()

  if (termsError || !termsRow) {
    console.error('Failed to load terms version for render:', termsError ?? batch.terms_version)
    return NextResponse.json(
      { error: `Terms version ${batch.terms_version} not found`, code: 'RENDER_FAILED' },
      { status: 500 }
    )
  }

  if (voucherNumbers) {
    return renderReprint({
      supabase,
      batch,
      vouchers,
      termsClauses: termsRow.clauses,
      voucherNumbers,
      userId: auth.userId,
    })
  }

  return renderFullBatch({ supabase, batch, vouchers, termsClauses: termsRow.clauses })
}

type AdminClient = Extract<PermissionCheckResult, { ok: true }>['supabase']

interface RenderContext {
  supabase: AdminClient
  batch: VoucherBatchRow
  vouchers: BatchVoucherRecord[]
  termsClauses: TermsClause[]
}

// Claims the batch for this invocation. Each branch is a single conditional
// UPDATE, so Postgres re-evaluates the predicate against the committed row and
// only one caller can ever win: any successful claim both bumps render_attempts
// and refreshes updated_at (voucher_batches has an updated_at trigger), which
// invalidates the predicate for everyone else.
async function claimBatchForRender(
  supabase: AdminClient,
  batch: VoucherBatchRow,
  attempt: number
): Promise<{ claimed: boolean; error?: string }> {
  const claim = { pdf_status: 'rendering' as const, render_attempts: attempt }

  const fresh = await supabase
    .from('voucher_batches')
    .update(claim)
    .eq('id', batch.id)
    .eq('render_attempts', batch.render_attempts)
    .in('pdf_status', ['pending', 'failed'])
    .select('id')

  if (fresh.error) return { claimed: false, error: fresh.error.message }
  if ((fresh.data?.length ?? 0) > 0) return { claimed: true }

  // Nobody released the batch, so take over only a demonstrably dead claim.
  const staleBefore = new Date(Date.now() - STALE_RENDER_TIMEOUT_MS).toISOString()
  const stale = await supabase
    .from('voucher_batches')
    .update(claim)
    .eq('id', batch.id)
    .eq('render_attempts', batch.render_attempts)
    .eq('pdf_status', 'rendering')
    .lt('updated_at', staleBefore)
    .select('id')

  if (stale.error) return { claimed: false, error: stale.error.message }
  return { claimed: (stale.data?.length ?? 0) > 0 }
}

async function renderFullBatch(context: RenderContext) {
  const { supabase, batch, vouchers, termsClauses } = context

  const claimIsStale =
    batch.pdf_status === 'rendering' &&
    Date.parse(batch.updated_at) < Date.now() - STALE_RENDER_TIMEOUT_MS

  if (batch.pdf_status !== 'pending' && batch.pdf_status !== 'failed' && !claimIsStale) {
    const inProgress = batch.pdf_status === 'rendering'
    return NextResponse.json(
      {
        error: inProgress
          ? 'A render is already in progress for this batch. Give it a minute and check the batch again.'
          : 'This batch has already been rendered',
        code: inProgress ? 'RENDER_IN_PROGRESS' : 'RENDER_ALREADY_COMPLETE',
        status: batch.pdf_status,
      },
      { status: 409 }
    )
  }

  // Bounded attempts with a visible error, never an endless retry loop (F51).
  if (batch.render_attempts >= MAX_RENDER_ATTEMPTS) {
    return NextResponse.json(
      {
        error: `This batch has failed to render ${MAX_RENDER_ATTEMPTS} times, so it will not be retried again. Generate a new batch, and cancel the cards in this one so the numbers are not left in limbo.`,
        code: 'RENDER_ATTEMPTS_EXHAUSTED',
        status: batch.pdf_status,
        renderAttempts: batch.render_attempts,
      },
      { status: 409 }
    )
  }

  // The attempt number is claimed atomically, so it also keeps the immutable
  // object path unique across a takeover of a dead render (F42).
  const attempt = batch.render_attempts + 1
  const claim = await claimBatchForRender(supabase, batch, attempt)

  if (claim.error) {
    console.error('Failed to claim voucher batch render:', claim.error)
    return NextResponse.json({ error: 'Failed to start render', code: 'RENDER_FAILED' }, { status: 500 })
  }
  if (!claim.claimed) {
    return NextResponse.json(
      {
        error: 'A render is already in progress for this batch. Give it a minute and check the batch again.',
        code: 'RENDER_IN_PROGRESS',
        status: 'rendering',
      },
      { status: 409 }
    )
  }

  const objectPath = `batches/${batch.id}/render-${attempt}.pdf`

  try {
    const html = buildVoucherBatchHtml({
      vouchers: vouchers.map(voucher => ({ voucherNumber: voucher.voucher_number, typeId: voucher.type_id })),
      typeDefinitions: batch.type_definitions,
      termsVersion: batch.terms_version,
      termsClauses,
    })

    const pdf = await generatePDFFromHTML(html, CARD_PDF_OPTIONS)

    const { error: uploadError } = await supabase.storage
      .from(VOUCHER_BUCKET)
      .upload(objectPath, pdf, { contentType: 'application/pdf', upsert: false })

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    const pdfPages = vouchers.length * PDF_PAGES_PER_CARD
    const { error: updateError } = await supabase
      .from('voucher_batches')
      .update({
        pdf_status: 'ready',
        pdf_path: objectPath,
        pdf_bytes: pdf.length,
        pdf_pages: pdfPages,
        render_attempts: attempt,
        render_error: null,
      })
      .eq('id', batch.id)

    if (updateError) {
      throw new Error(`Failed to record render result: ${updateError.message}`)
    }

    return NextResponse.json({
      status: 'ready',
      pdfPath: objectPath,
      pdfBytes: pdf.length,
      pdfPages,
      renderAttempts: attempt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render failed'
    console.error('Voucher batch render failed:', error)

    const { error: failError } = await supabase
      .from('voucher_batches')
      .update({
        pdf_status: 'failed',
        render_attempts: attempt,
        render_error: message.slice(0, RENDER_ERROR_MAX_LENGTH),
      })
      .eq('id', batch.id)

    if (failError) {
      console.error('Failed to record voucher render failure:', failError)
    }

    return NextResponse.json(
      { status: 'failed', error: message.slice(0, RENDER_ERROR_MAX_LENGTH), code: 'RENDER_FAILED' },
      { status: 500 }
    )
  }
}

interface ReprintContext extends RenderContext {
  voucherNumbers: string[]
  userId: string
}

async function renderReprint(context: ReprintContext) {
  const { supabase, batch, vouchers, termsClauses, voucherNumbers, userId } = context

  const byNumber = new Map(vouchers.map(voucher => [voucher.voucher_number, voucher]))
  const missing = voucherNumbers.filter(voucherNumber => !byNumber.has(voucherNumber))
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Vouchers not in this batch: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  // Deduplicated so a repeated number cannot double-print a card or write two
  // reprint events for one physical reprint.
  const subset = Array.from(new Set(voucherNumbers)).map(
    voucherNumber => byNumber.get(voucherNumber) as BatchVoucherRecord
  )

  // Enforced here, not only in the ledger UI: a direct POST must never be able
  // to reproduce a pixel-identical card for a terminal voucher (spec 2.5).
  const terminal = subset.filter(voucher => NON_REPRINTABLE_STATUSES.includes(voucher.status))
  if (terminal.length > 0) {
    const numbers = terminal.map(voucher => voucher.voucher_number)
    return NextResponse.json(
      {
        error: `Cancelled and replaced vouchers can never be reprinted: ${numbers.join(', ')}`,
        code: 'VOUCHER_NOT_REPRINTABLE',
        voucherNumbers: numbers,
      },
      { status: 409 }
    )
  }

  const objectPath = `batches/${batch.id}/reprint-${Date.now()}.pdf`

  try {
    const html = buildVoucherBatchHtml({
      vouchers: subset.map(voucher => ({ voucherNumber: voucher.voucher_number, typeId: voucher.type_id })),
      typeDefinitions: batch.type_definitions,
      termsVersion: batch.terms_version,
      termsClauses,
    })

    const pdf = await generatePDFFromHTML(html, CARD_PDF_OPTIONS)

    const { error: uploadError } = await supabase.storage
      .from(VOUCHER_BUCKET)
      .upload(objectPath, pdf, { contentType: 'application/pdf', upsert: false })

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(VOUCHER_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, {
        download: `voucher-reprint-${batch.id.slice(0, 8)}.pdf`,
      })

    if (signError || !signed?.signedUrl) {
      throw new Error(`Failed to sign reprint URL: ${signError?.message ?? 'no URL returned'}`)
    }

    // The PDF exists at this point, so a failure to write the trail must never
    // fail the reprint: recordReprintTrail logs and swallows its own errors.
    await recordReprintTrail({ supabase, batch, subset, userId })

    return NextResponse.json({
      status: 'ready',
      url: signed.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      pdfPages: subset.length * PDF_PAGES_PER_CARD,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reprint render failed'
    console.error('Voucher reprint render failed:', error)
    return NextResponse.json(
      { status: 'failed', error: message.slice(0, RENDER_ERROR_MAX_LENGTH), code: 'RENDER_FAILED' },
      { status: 500 }
    )
  }
}

// Mirrors requireVouchersManage in src/app/actions/vouchers.ts: the display name
// off the account, falling back to the email, then to a generic label.
async function resolveActorName(supabase: AdminClient, userId: string): Promise<string> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user) return 'Manager'
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
    const fullName =
      typeof meta.full_name === 'string' && meta.full_name.trim().length > 0
        ? meta.full_name.trim()
        : null
    return fullName ?? data.user.email ?? 'Manager'
  } catch {
    return 'Manager'
  }
}

// voucher_events is the authoritative trail (spec 7.1), so duplicating a
// physical card has to leave a trace. detail carries the batch and the size of
// the reprint only, never customer names or phone numbers (F37).
async function recordReprintTrail(context: {
  supabase: AdminClient
  batch: VoucherBatchRow
  subset: BatchVoucherRecord[]
  userId: string
}): Promise<void> {
  const { supabase, batch, subset, userId } = context
  const action: VoucherEventAction = 'reprinted'
  const source: VoucherEventSource = 'management'

  try {
    const actorName = await resolveActorName(supabase, userId)
    const { error } = await supabase.from('voucher_events').insert(
      subset.map(voucher => ({
        voucher_id: voucher.id,
        action,
        actor_user_id: userId,
        actor_employee_id: null,
        actor_name: actorName,
        source,
        detail: { batch_id: batch.id, count: subset.length },
      }))
    )
    if (error) {
      console.warn('Failed to record voucher reprint events:', error.message)
    }
  } catch (error) {
    console.warn('Failed to record voucher reprint events:', error)
  }

  try {
    await logAuditEvent({
      user_id: userId,
      operation_type: 'reprint',
      resource_type: 'voucher_batch',
      resource_id: batch.id,
      operation_status: 'success',
      additional_info: {
        count: subset.length,
        voucher_numbers: subset.map(voucher => voucher.voucher_number),
      },
    })
  } catch (error) {
    console.warn('Failed to audit voucher reprint:', error)
  }
}
