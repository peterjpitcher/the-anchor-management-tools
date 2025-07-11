import { createAdminClient } from '@/lib/supabase/server'

async function deleteInvoice(invoiceId: string) {
  try {
    const supabase = await createAdminClient()
    
    console.log(`Deleting invoice: ${invoiceId}`)
    
    // First, delete the line items
    const { error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .delete()
      .eq('invoice_id', invoiceId)
    
    if (lineItemsError) {
      console.error('Error deleting line items:', lineItemsError)
      return
    }
    
    console.log('✓ Line items deleted')
    
    // Then delete the invoice
    const { error: invoiceError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
    
    if (invoiceError) {
      console.error('Error deleting invoice:', invoiceError)
      return
    }
    
    console.log('✓ Invoice deleted successfully')
    
  } catch (error) {
    console.error('Error:', error)
  }
}

// Run the deletion
deleteInvoice('fcee02c7-a0c4-4a85-8bb7-4361f3ff3bcf')