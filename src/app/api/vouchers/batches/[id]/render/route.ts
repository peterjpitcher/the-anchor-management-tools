import { NextRequest, NextResponse } from 'next/server'

// Puppeteer render path: Node runtime, long budget (spec 3.2, F23; benchmark
// gate F22 may adjust this).
export const runtime = 'nodejs'
export const maxDuration = 300

import { requireModulePermission, type PermissionCheckResult } from '@/lib/api/permissions'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { buildVoucherBatchHtml } from '@/lib/voucher-card-template'
import { PDF_PAGES_PER_CARD } from '@/lib/vouchers/constants'
import type { TermsClause, VoucherBatchRow } from '@/types/vouchers'

const VOUCHER_BUCKET = 'vouchers'
const SIGNED_URL_TTL_SECONDS = 600
const RENDER_ERROR_MAX_LENGTH = 500

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
  voucher_number: string
  type_id: string
  status: string
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
    .select('voucher_number, type_id, status')
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
    return renderReprint({ supabase, batch, vouchers, termsClauses: termsRow.clauses, voucherNumbers })
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

async function renderFullBatch(context: RenderContext) {
  const { supabase, batch, vouchers, termsClauses } = context

  if (batch.pdf_status !== 'pending' && batch.pdf_status !== 'failed') {
    const message = batch.pdf_status === 'rendering'
      ? 'A render is already in progress for this batch'
      : 'This batch has already been rendered'
    return NextResponse.json({ error: message, status: batch.pdf_status }, { status: 409 })
  }

  // Conditional claim so two concurrent calls cannot both render (F33/F51)
  const { data: claimed, error: claimError } = await supabase
    .from('voucher_batches')
    .update({ pdf_status: 'rendering' })
    .eq('id', batch.id)
    .in('pdf_status', ['pending', 'failed'])
    .select('id')

  if (claimError) {
    console.error('Failed to claim voucher batch render:', claimError)
    return NextResponse.json({ error: 'Failed to start render', code: 'RENDER_FAILED' }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: 'A render is already in progress for this batch', status: 'rendering' },
      { status: 409 }
    )
  }

  const attempt = batch.render_attempts + 1
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
}

async function renderReprint(context: ReprintContext) {
  const { supabase, batch, vouchers, termsClauses, voucherNumbers } = context

  const byNumber = new Map(vouchers.map(voucher => [voucher.voucher_number, voucher]))
  const missing = voucherNumbers.filter(voucherNumber => !byNumber.has(voucherNumber))
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Vouchers not in this batch: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const subset = voucherNumbers.map(voucherNumber => byNumber.get(voucherNumber) as BatchVoucherRecord)
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
