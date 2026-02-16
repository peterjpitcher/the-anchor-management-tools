#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-customer-preferences'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const supabase = createAdminClient()

  console.log('=== Checking Customer Event Preferences ===\n')

  // Get customers who have category stats
  const { data: customersWithStats, error: customersWithStatsError } = await (supabase.from('customer_category_stats') as any)
    .select(
      `
      customer:customers!inner(
        id,
        first_name,
        last_name
      )
    `
    )
    .limit(3)

  if (customersWithStatsError) {
    markFailure('Failed to query customer_category_stats.', customersWithStatsError)
    return
  }

  const customers = customersWithStats?.map((s: any) => s.customer).filter(Boolean) || []
  if (!customers || customers.length === 0) {
    console.log('No customers with category stats found (customer_category_stats is empty?)')
    return
  }

  for (const customer of customers) {
    console.log(`\nCustomer: ${customer.first_name} ${customer.last_name}`)

    // Get their category stats
    const { data: stats, error } = await (supabase.from('customer_category_stats') as any)
      .select(
        `
          times_attended,
          last_attended_date,
          event_categories!inner(
            id,
            name
          )
        `
      )
      .eq('customer_id', customer.id)
      .order('times_attended', { ascending: false })

    if (error) {
      markFailure(`Error fetching stats for customer ${customer.id}.`, error)
      continue
    }

    if (stats && stats.length > 0) {
      console.log('Event preferences:')
      stats.forEach((s: any) => {
        console.log(
          `  - ${s.event_categories?.name}: attended ${s.times_attended} times (last: ${s.last_attended_date})`
        )
      })
    } else {
      console.log('  No event preferences found')
    }
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Customer preferences check completed with failures.')
  } else {
    console.log('\n✅ Customer preferences check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-customer-preferences failed.', error)
})

