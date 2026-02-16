import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

async function testEventImageSchema() {
  console.log('Event image field diagnostics (read-only)\n')

  const supabase = createAdminClient()

  console.log('1. Verifying new event image fields are selectable...')
  const { data: sample, error: newFieldError } = await supabase
    .from('events')
    .select('id, hero_image_url, thumbnail_image_url, poster_image_url')
    .limit(1)
    .maybeSingle()

  if (newFieldError) {
    throw new Error(`New image field select failed: ${newFieldError.message}`)
  }

  console.log(
    '✅ New image fields are selectable',
    sample ? `(sample event id: ${sample.id})` : '(no rows)',
  )

  console.log('\n2. Verifying legacy image_url field is not selectable (expected)...')
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

testEventImageSchema().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
