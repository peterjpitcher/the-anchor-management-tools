import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function fixRpcFunctions() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  if (argv.includes('--help')) {
    console.log(`
fix-rpc-functions-direct (read-only diagnostics)

Usage:
  ts-node scripts/fixes/fix-rpc-functions-direct.ts
`)
    return
  }

  console.log('=== RPC Function Diagnostics (read-only) ===\n')

  const supabase = createAdminClient()

  // First, let's test the current function to see the exact error
  console.log('1. Testing current get_category_regulars function...')
  const { data: categoriesResult, error: categoriesError } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(1)

  const categories = (assertScriptQuerySucceeded({
    operation: 'Load event category sample',
    error: categoriesError,
    data: categoriesResult ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; name: string }>

  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`   Testing with category: ${categories[0].name}`)
    
    const { data: regulars, error: testError } = await supabase
      .rpc('get_category_regulars', { 
        p_category_id: categoryId,
        p_days_back: 365
      })

    if (testError) {
      markFailure('get_category_regulars error', testError)
      
      // Now let's manually query the data to see what works
      console.log('\n2. Testing manual query...')
      const { data: manualDataResult, error: manualError } = await supabase
        .from('customer_category_stats')
        .select(`
          customer_id,
          times_attended,
          last_attended_date,
          customers!inner(
            id,
            first_name,
            last_name,
            mobile_number,
            sms_opt_in
          )
        `)
        .eq('category_id', categoryId)
        .eq('customers.sms_opt_in', true)
        .order('times_attended', { ascending: false })
        .limit(10)

      const manualData = (assertScriptQuerySucceeded({
        operation: 'Load manual customer category stats',
        error: manualError,
        data: manualDataResult ?? [],
        allowMissing: true
      }) ?? []) as Array<{
        times_attended: number
        customers?: {
          first_name?: string | null
          last_name?: string | null
        } | null
      }>

      console.log(`   ✓ Manual query found ${manualData?.length || 0} customers`)
      manualData?.slice(0, 3).forEach(d => {
        const c = (d as any).customers
        console.log(`     - ${c.first_name} ${c.last_name} (attended ${d.times_attended} times)`)
      })
    } else {
      console.log(`   ✓ Function already works! Found ${regulars?.length || 0} customers`)
    }
  } else {
    markFailure('No event categories found; cannot test get_category_regulars')
  }
}

fixRpcFunctions().catch((error) => markFailure('fix-rpc-functions-direct failed', error))
