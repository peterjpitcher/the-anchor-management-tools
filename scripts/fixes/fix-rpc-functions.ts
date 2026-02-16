import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const FIX_REGULARS_SQL = `
CREATE OR REPLACE FUNCTION "public"."get_category_regulars"(
  "p_category_id" "uuid",
  "p_days_back" integer DEFAULT 90
)
RETURNS TABLE(
  "customer_id" "uuid",
  "first_name" text,
  "last_name" text,
  "mobile_number" text,
  "times_attended" integer,
  "last_attended_date" "date",
  "days_since_last_visit" integer
)
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.first_name::text,
    c.last_name::text,
    c.mobile_number::text,
    ccs.times_attended,
    ccs.last_attended_date,
    EXTRACT(DAY FROM NOW() - ccs.last_attended_date)::INTEGER as days_since_last_visit
  FROM customer_category_stats ccs
  JOIN customers c ON c.id = ccs.customer_id
  WHERE ccs.category_id = p_category_id
    AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '1 day' * p_days_back
    AND c.sms_opt_in = true
  ORDER BY ccs.times_attended DESC, ccs.last_attended_date DESC;
END;
$$;
`.trim()

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
fix-rpc-functions (read-only diagnostics)

This script no longer executes DDL automatically. If the function is broken, it prints the SQL patch to apply manually.

Usage:
  ts-node scripts/fixes/fix-rpc-functions.ts
`)
    return
  }

  const supabase = createAdminClient()

  console.log('=== RPC Function Diagnostics (read-only) ===\n')
  console.log('1. Testing get_category_regulars function...')

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

  if (!categories || categories.length === 0) {
    markFailure('No event categories found; cannot test get_category_regulars')
    return
  }

  const categoryId = categories[0].id
  console.log(`   Testing with category: ${categories[0].name}`)

  const { data: regulars, error: testError } = await supabase.rpc('get_category_regulars', {
    p_category_id: categoryId,
    p_days_back: 365
  })

  if (testError) {
    markFailure('get_category_regulars failed (manual SQL patch required)', testError)
    console.log('\nSuggested patch (run in Supabase SQL editor):\n')
    console.log(FIX_REGULARS_SQL)
    return
  }

  console.log(`   ✓ Found ${regulars?.length || 0} regular customers`)
  ;(regulars ?? []).slice(0, 3).forEach((r: any) =>
    console.log(`     - ${r.first_name} ${r.last_name} (attended ${r.times_attended} times)`)
  )
}

fixRpcFunctions().catch((error) => markFailure('fix-rpc-functions failed', error))
