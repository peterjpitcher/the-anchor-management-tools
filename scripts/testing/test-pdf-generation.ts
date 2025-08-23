#!/usr/bin/env tsx

/*
 * Test PDF Generation
 * 
 * This script tests the PDF generation functionality for invoices and quotes
 * 
 * Usage: tsx scripts/test-pdf-generation.ts
 */

import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
import { writeFileSync } from 'fs'
import { join } from 'path'

async function testPDFGeneration() {
  console.log('Testing PDF generation...\n')

  try {
    // Get a sample invoice and quote
    const supabase = await createClient()
    
    // Get first invoice
    console.log('Fetching sample invoice...')
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:invoice_line_items(*)
      `)
      .limit(1)
      .single()

    if (invoiceError || !invoice) {
      console.error('Error fetching invoice:', invoiceError)
      console.log('No invoices found to test with')
    } else {
      console.log(`Found invoice: ${invoice.invoice_number}`)
      console.log('Generating invoice PDF...')
      
      const pdfBuffer = await generateInvoicePDF(invoice as any)
      const outputPath = join(process.cwd(), `test-invoice-${invoice.invoice_number}.pdf`)
      writeFileSync(outputPath, pdfBuffer)
      
      console.log(`✓ Invoice PDF saved to: ${outputPath}`)
      console.log(`  Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`)
    }

    // Get first quote
    console.log('\nFetching sample quote...')
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:quote_line_items(*)
      `)
      .limit(1)
      .single()

    if (quoteError || !quote) {
      console.error('Error fetching quote:', quoteError)
      console.log('No quotes found to test with')
    } else {
      console.log(`Found quote: ${quote.quote_number}`)
      console.log('Generating quote PDF...')
      
      const pdfBuffer = await generateQuotePDF(quote as any)
      const outputPath = join(process.cwd(), `test-quote-${quote.quote_number}.pdf`)
      writeFileSync(outputPath, pdfBuffer)
      
      console.log(`✓ Quote PDF saved to: ${outputPath}`)
      console.log(`  Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`)
    }

    console.log('\n✅ PDF generation test completed successfully!')
    console.log('Check the generated PDF files in the project root directory.')
    
  } catch (error) {
    console.error('Error during PDF generation test:', error)
    process.exit(1)
  }
}

// Run the test
testPDFGeneration().catch(console.error)