#!/usr/bin/env tsx

import { createAdminClient } from '@/lib/supabase/server'

async function deleteTestInvoices() {
  console.log('🗑️  Starting test invoice deletion...\n')
  
  try {
    const supabase = await createAdminClient()
    
    // First, let's find all TEST- invoices
    const { data: testInvoices, error: fetchError } = await supabase
      .from('invoices')
      .select('id, invoice_number, vendor_id, total_amount, created_at')
      .like('invoice_number', 'TEST-%')
      .order('created_at', { ascending: false })
    
    if (fetchError) {
      console.error('❌ Error fetching test invoices:', fetchError)
      return
    }
    
    if (!testInvoices || testInvoices.length === 0) {
      console.log('✅ No test invoices found.')
      return
    }
    
    console.log(`Found ${testInvoices.length} test invoice(s):\n`)
    testInvoices.forEach((invoice, index) => {
      console.log(`${index + 1}. Invoice: ${invoice.invoice_number}`)
      console.log(`   Amount: £${invoice.total_amount}`)
      console.log(`   Created: ${new Date(invoice.created_at).toLocaleString()}\n`)
    })
    
    // Ask for confirmation
    console.log('⚠️  WARNING: This will permanently delete these invoices and all related data.')
    console.log('⚠️  Related records (line items, payments, etc.) will also be deleted.\n')
    
    // Since we can't do interactive input in a script, we'll add a safety check
    // Uncomment the line below to actually delete
    // const CONFIRM_DELETE = true
    const CONFIRM_DELETE = false
    
    if (!CONFIRM_DELETE) {
      console.log('❌ Deletion cancelled. To proceed, edit the script and set CONFIRM_DELETE = true')
      return
    }
    
    console.log('🔄 Deleting test invoices...\n')
    
    // Delete each invoice
    for (const invoice of testInvoices) {
      console.log(`Deleting ${invoice.invoice_number}...`)
      
      // Check for related records that might need manual deletion
      const { data: emailLogs } = await supabase
        .from('invoice_email_logs')
        .select('id')
        .eq('invoice_id', invoice.id)
      
      if (emailLogs && emailLogs.length > 0) {
        console.log(`  - Found ${emailLogs.length} email log(s)`)
      }
      
      // Delete the invoice (line items and payments will cascade)
      const { error: deleteError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoice.id)
      
      if (deleteError) {
        console.error(`❌ Error deleting invoice ${invoice.invoice_number}:`, deleteError)
      } else {
        console.log(`✅ Successfully deleted ${invoice.invoice_number}`)
      }
    }
    
    console.log('\n✅ Test invoice deletion complete!')
    
    // Show summary of remaining invoices
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
    
    console.log(`\nTotal invoices remaining in database: ${count}`)
    
  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Run the script
deleteTestInvoices()