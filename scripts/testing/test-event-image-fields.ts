import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

async function testEventImageFields() {
  console.log('Event image field diagnostics (read-only)\n')

  const supabase = createAdminClient()

  console.log('1. Verifying event image fields are selectable...')
  const { data: events, error: queryError } = await supabase
    .from('events')
    .select('id, name, hero_image_url, image_urls, gallery_image_urls')
    .limit(1)
    .maybeSingle()

  if (queryError) {
    throw new Error(`Event image field select failed: ${queryError.message}`)
  }

  console.log('✅ Event image fields are selectable', events ? `(sample event id: ${events.id})` : '(no rows)')

  console.log('\n2. Verifying event_categories image_url field is selectable...')
  const { data: category, error: categoryError } = await supabase
    .from('event_categories')
    .select('id, name, slug, image_url')
    .limit(1)
    .maybeSingle()

  if (categoryError) {
    throw new Error(`event_categories image_url select failed: ${categoryError.message}`)
  }

  console.log('✅ event_categories image_url is selectable', category ? `(sample category id: ${category.id})` : '(no rows)')

  console.log('\n3. Verifying legacy events.image_url field is not selectable (expected)...')
  const { error: legacyFieldError } = await supabase
    .from('events')
    .select('id, image_url')
    .limit(1)

  if (!legacyFieldError) {
    throw new Error('Legacy image_url field is still selectable; expected it to be removed')
  }

  console.log(`✅ Legacy image_url select failed as expected: ${legacyFieldError.message}`)
  console.log('\n✅ Event image field diagnostics complete.')
}

testEventImageFields().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
