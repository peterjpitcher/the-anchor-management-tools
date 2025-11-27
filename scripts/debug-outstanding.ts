
import { config } from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '@/lib/supabase/admin'

async function main() {
  const supabase = createAdminClient()

  console.log('Fetching pending receipts...')

  const { data: receipts, error } = await supabase
    .from('receipt_transactions')
    .select('id, transaction_date, details, amount_in, amount_out, status')
    .eq('status', 'pending')
    .order('transaction_date', { ascending: true })

  if (error) {
    console.error('Error fetching receipts:', error)
    return
  }

  console.log(`Found ${receipts.length} pending receipts:`)
  
  if (receipts.length === 0) {
      console.log("No pending receipts found via direct query.")
  }

  receipts.forEach((r) => {
    console.log(`- [${r.transaction_date}] ${r.details} (In: ${r.amount_in}, Out: ${r.amount_out}) ID: ${r.id}`)
  })
  
  // Also check counts from RPC to verify discrepancy
  const { data: statusCounts, error: countError } = await supabase.rpc('count_receipt_statuses')
  if (countError) {
      console.error("Error fetching counts:", countError)
  } else {
      console.log("RPC Counts:", statusCounts)
  }
}

main().catch(console.error)
