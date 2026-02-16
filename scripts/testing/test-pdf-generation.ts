#!/usr/bin/env tsx

/*
 * Test PDF Generation
 *
 * This script tests the PDF generation functionality for invoices and quotes
 *
 * Safety note:
 * - Strictly read-only (DB selects only).
 * - Fails closed on env/query failures; exits non-zero if no PDFs were generated.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
import { writeFileSync } from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function assertReadOnlyScript(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--confirm')) {
    throw new Error('test-pdf-generation is read-only and does not support --confirm.')
  }
}

async function run(): Promise<void> {
  assertReadOnlyScript()

  console.log('PDF generation diagnostics (read-only)\n')

  const supabase = createAdminClient()
  let generated = 0

  console.log('1) Fetching sample invoice...')
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(
      `
      *,
      vendor:invoice_vendors(*),
      line_items:invoice_line_items(*)
    `
    )
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (invoiceError) {
    throw new Error(`Invoice lookup failed: ${invoiceError.message}`)
  }

  if (!invoice) {
    console.log('No invoices found to test with.')
  } else {
    console.log(`Found invoice: ${invoice.invoice_number || invoice.id}`)
    console.log('Generating invoice PDF...')

    const pdfBuffer = await generateInvoicePDF(invoice as any)
    const suffix = invoice.invoice_number || invoice.id || 'unknown'
    const outputPath = path.join(process.cwd(), `test-invoice-${suffix}.pdf`)
    writeFileSync(outputPath, pdfBuffer)
    generated += 1

    console.log(`OK Invoice PDF saved: ${outputPath}`)
    console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB\n`)
  }

  console.log('2) Fetching sample quote...')
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select(
      `
      *,
      vendor:invoice_vendors(*),
      line_items:quote_line_items(*)
    `
    )
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (quoteError) {
    throw new Error(`Quote lookup failed: ${quoteError.message}`)
  }

  if (!quote) {
    console.log('No quotes found to test with.')
  } else {
    console.log(`Found quote: ${quote.quote_number || quote.id}`)
    console.log('Generating quote PDF...')

    const pdfBuffer = await generateQuotePDF(quote as any)
    const suffix = quote.quote_number || quote.id || 'unknown'
    const outputPath = path.join(process.cwd(), `test-quote-${suffix}.pdf`)
    writeFileSync(outputPath, pdfBuffer)
    generated += 1

    console.log(`OK Quote PDF saved: ${outputPath}`)
    console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB\n`)
  }

  if (generated === 0) {
    throw new Error('No PDFs were generated (no sample invoice/quote rows found).')
  }

  console.log('✅ PDF generation diagnostics completed successfully.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
