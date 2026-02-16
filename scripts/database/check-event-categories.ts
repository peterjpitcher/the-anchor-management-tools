#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkEventCategories() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-event-categories is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('\n🏷️  Checking Event Categories...\n')

  const { data: categoriesRows, error } = await supabase
    .from('event_categories')
    .select(
      'id, name, is_active, color, icon, description, default_performer_name, sort_order'
    )
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const categories = (assertScriptQuerySucceeded({
    operation: 'Load event categories',
    error,
    data: categoriesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    name: string | null
    is_active: boolean | null
    color: string | null
    icon: string | null
    description: string | null
    default_performer_name: string | null
  }>

  console.log(`Found ${categories.length} event category(s):\n`)

  categories.forEach((category, index) => {
    console.log(`${index + 1}. ${category.name || 'unknown'}`)
    console.log(`   ID: ${category.id}`)
    console.log(`   Active: ${category.is_active ? 'yes' : 'no'}`)
    console.log(`   Color: ${category.color || 'none'}`)
    console.log(`   Icon: ${category.icon || 'none'}`)
    if (category.description) {
      console.log(`   Description: ${category.description}`)
    }
    if (category.default_performer_name) {
      console.log(`   Default Performer: ${category.default_performer_name}`)
    }
    console.log('')
  })

  console.log('\n📊 Events per Category:\n')

  for (const category of categories) {
    const { count, error: countError } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', category.id)

    if (countError) {
      markFailure(`Failed counting events for category '${category.name || category.id}'.`, countError)
      continue
    }

    console.log(`${category.name || category.id}: ${count || 0} events`)
  }

  console.log('\n🔍 Searching for drag-related events without categories...\n')

  const { data: dragEventsRows, error: dragError } = await supabase
    .from('events')
    .select('id, title, category_id')
    .or('title.ilike.%drag%,title.ilike.%cabaret%,title.ilike.%gameshow%,title.ilike.%house party%')
    .is('category_id', null)
    .order('created_at', { ascending: false })
    .limit(10)

  const dragEvents = (assertScriptQuerySucceeded({
    operation: 'Load uncategorized drag/gameshow event candidates',
    error: dragError,
    data: dragEventsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ title: string | null }>

  if (dragEvents.length > 0) {
    console.log(`Found ${dragEvents.length} uncategorized event(s) that might be drag/gameshow:`)
    dragEvents.forEach((event) => {
      console.log(`- ${event.title || 'unknown'}`)
    })
  } else {
    console.log('No uncategorized drag/gameshow events found.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Event categories check completed with failures.')
  } else {
    console.log('\n✅ Event categories check complete!')
  }
}

void checkEventCategories().catch((error) => {
  markFailure('check-event-categories failed.', error)
})
