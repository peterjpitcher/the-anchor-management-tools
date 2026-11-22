/**
 * Publishes a trimmed copy of the December seasonal masthead.
 *
 * The December original the owner supplied has a white band above and below the green
 * (about 6% and 7.5% of its height). On its own that passes, but with a photo straight under
 * the masthead the lower band shows as a white strip between the two. The owner asked for it
 * to go on 22 November 2026 ("Remove the white strip between the banner and photo").
 *
 * This cuts the white rows off, takes the same proportion off the two sides so the shape
 * stays 3:1 (the block writes width 600 and height 200, and Outlook obeys those attributes),
 * and writes a 1200 x 400 JPEG beside the others as `12-december-trimmed.jpg`. The original
 * `12-december.jpg` is left alone, because other scheduled emails point at it.
 *
 * Dry run by default. RUN_DECEMBER_MASTHEAD_TRIM_MUTATION=true uploads.
 * DECEMBER_MASTHEAD_TRIM_OUT=<path> also writes the JPEG to that file to look at.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'
import sharp from 'sharp'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const SOURCE = path.join(process.cwd(), 'docs', 'design', 'email-seasonal', '12-december.png')
const BUCKET = 'event-images'
const OBJECT_PATH = 'marketing/seasonal-masthead/12-december-trimmed.jpg'
const OUT_WIDTH = 1200
const OUT_HEIGHT = 400
/** A row counts as white when nearly all of it is brighter than this on every channel. */
const WHITE_LEVEL = 235

async function main(): Promise<void> {
  const original = readFileSync(SOURCE)
  const { data, info } = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  const rowIsWhite = (y: number): boolean => {
    let white = 0
    let sampled = 0
    for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * channels
      if (Math.min(data[i], data[i + 1], data[i + 2]) > WHITE_LEVEL) white += 1
      sampled += 1
    }
    return white / sampled > 0.2
  }

  let top = 0
  while (top < height && rowIsWhite(top)) top += 1
  let bottom = height - 1
  while (bottom > top && rowIsWhite(bottom)) bottom -= 1

  // Two more rows each side, so no soft grey edge row from the artwork's own anti-aliasing.
  top += 2
  bottom -= 2
  const cropHeight = bottom - top + 1
  const cropWidth = Math.round((cropHeight * OUT_WIDTH) / OUT_HEIGHT)
  if (cropWidth > width) throw new Error('The green band is too tall to keep 3:1 by trimming the sides')
  const left = Math.round((width - cropWidth) / 2)

  const jpeg = await sharp(original)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: OUT_WIDTH, height: OUT_HEIGHT, fit: 'fill' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  console.warn(`source ${width}x${height}; white rows above ${top - 2}, below ${height - 1 - bottom - 2}`)
  console.warn(`crop   ${cropWidth}x${cropHeight} from (${left}, ${top}) -> ${OUT_WIDTH}x${OUT_HEIGHT}, ${Math.round(jpeg.length / 1024)}KB`)

  const out = process.env.DECEMBER_MASTHEAD_TRIM_OUT
  if (out) writeFileSync(out, jpeg)

  assertScriptMutationAllowed({
    scriptName: 'publish-december-masthead-trimmed',
    envVar: 'RUN_DECEMBER_MASTHEAD_TRIM_MUTATION',
  })

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(OBJECT_PATH, jpeg, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(error.message)
  console.warn(supabase.storage.from(BUCKET).getPublicUrl(OBJECT_PATH).data.publicUrl)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
