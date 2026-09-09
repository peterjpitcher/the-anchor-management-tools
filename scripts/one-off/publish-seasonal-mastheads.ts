/**
 * Publishes the twelve seasonal mastheads for the monthly round-up.
 *
 * The owner supplied twelve 2172 x 724 PNGs, one per month, each the green Anchor masthead
 * with that month's foliage around the wordmark. The originals live in
 * `docs/design/email-seasonal/` and are never sent: at roughly 1.9MB each they would land in
 * an inbox at full weight, because PNG ignores the quality setting and Supabase's transform
 * endpoint cannot rescue it. This writes a 1200 wide JPEG of each, which is twice the 600px
 * render width, and comes out around 79KB.
 *
 * They go in `event-images` under a `marketing/seasonal-masthead/` prefix. That bucket is
 * named for its first use rather than its only one; it is the app's public image store and
 * the alternative was a new bucket with its own policies and anon grants for twelve files.
 *
 * Dry run by default. RUN_SEASONAL_MASTHEAD_MUTATION=true uploads.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'
import sharp from 'sharp'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const SOURCE_DIR = path.join(process.cwd(), 'docs', 'design', 'email-seasonal')
const BUCKET = 'event-images'
const PREFIX = 'marketing/seasonal-masthead'

/** Twice the 600px render width, so it stays sharp on a retina screen. */
const RENDER_WIDTH = 600
const JPEG_QUALITY = 82

/**
 * Supabase storage throws a bare `fetch failed` from undici now and then, at a different
 * file each run. Four attempts turns a flaky upload into a slow one.
 */
async function withRetry<T>(label: string, work: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      lastError = error
      console.warn(`  ${label}: attempt ${attempt} failed (${(error as Error).message}), retrying`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw lastError
}

async function main(): Promise<void> {
  const sources = readdirSync(SOURCE_DIR)
    .filter((name) => /^\d{2}-[a-z]+\.png$/.test(name))
    .sort()

  if (sources.length !== 12) {
    throw new Error(`Expected twelve month files in ${SOURCE_DIR}, found ${sources.length}`)
  }

  const prepared = await Promise.all(
    sources.map(async (name) => {
      const original = readFileSync(path.join(SOURCE_DIR, name))
      const source = await sharp(original).metadata()
      const jpeg = await sharp(original)
        .resize({ width: RENDER_WIDTH * 2, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer()
      const rendered = await sharp(jpeg).metadata()

      // The block writes width and height attributes from these numbers, and Outlook obeys
      // the attributes rather than the CSS, so a wrong ratio here draws a squashed masthead.
      const height = Math.round((RENDER_WIDTH * (rendered.height ?? 0)) / (rendered.width ?? 1))

      return {
        name,
        objectPath: `${PREFIX}/${name.replace(/\.png$/, '.jpg')}`,
        jpeg,
        sourceSize: original.length,
        sourceDims: `${source.width}x${source.height}`,
        renderedDims: `${rendered.width}x${rendered.height}`,
        emailDims: `${RENDER_WIDTH}x${height}`,
      }
    }),
  )

  for (const item of prepared) {
    console.warn(
      `${item.name.padEnd(16)} ${item.sourceDims.padEnd(10)} ${String(Math.round(item.sourceSize / 1024)).padStart(5)}KB` +
        ` -> ${item.renderedDims.padEnd(9)} ${String(Math.round(item.jpeg.length / 1024)).padStart(4)}KB` +
        `  renders ${item.emailDims}`,
    )
  }

  const ratios = new Set(prepared.map((item) => item.emailDims))
  if (ratios.size !== 1) {
    throw new Error(`The twelve images are not one shape: ${[...ratios].join(', ')}`)
  }
  console.warn(`\nAll twelve render at ${[...ratios][0]}.`)

  assertScriptMutationAllowed({
    scriptName: 'publish-seasonal-mastheads',
    envVar: 'RUN_SEASONAL_MASTHEAD_MUTATION',
  })

  const supabase = createAdminClient()

  for (const item of prepared) {
    await withRetry(item.name, async () => {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(item.objectPath, item.jpeg, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(error.message)
    })

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(item.objectPath)
    console.warn(`${item.name.replace(/\.png$/, '').padEnd(16)} ${data.publicUrl}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
