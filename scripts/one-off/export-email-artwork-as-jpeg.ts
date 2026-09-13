/**
 * Re-exports the event artwork used in marketing emails as JPEG.
 *
 * The artwork is poster PNGs of 3 to 5MB each. The website never feels that, because it serves
 * them through next/image, which re-encodes and resizes on the fly. Email has no such stage:
 * whatever URL the campaign carries is what lands in the inbox, so a four-event round-up would
 * pull several megabytes over mobile data. PNG also ignores a quality setting, so Supabase's
 * own transform endpoint cannot help: the smallest useful render of one poster is still ~940KB.
 *
 * So this writes a JPEG beside each original, suffixed `-email.jpg`, sized at twice its render
 * size for retina. The originals are left exactly where they are, and `events.*_image_url` is
 * deliberately NOT repointed: the website is already fine and does not need this.
 *
 * Squares render at 600px in `image_full`, landscapes at 536px in `feature_card`.
 *
 * Dry run by default. RUN_EMAIL_ARTWORK_JPEG_MUTATION=true uploads.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import sharp from 'sharp'

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'event-images'
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`

/** Squares are rendered 600px wide by image_full, landscapes 536px by feature_card. */
const RENDER_WIDTH = { square: 600, landscape: 536 } as const
const JPEG_QUALITY = 82

interface Job {
  kind: keyof typeof RENDER_WIDTH
  /** Storage path inside the bucket, e.g. events/<id>/square/branded/x.png */
  path: string
}

/** Turns a public storage URL into the path inside the bucket. */
export function storagePathFromUrl(url: string): string {
  const index = url.indexOf(PUBLIC_PREFIX)
  if (index === -1) throw new Error(`Not a public ${BUCKET} URL: ${url}`)
  return decodeURIComponent(url.slice(index + PUBLIC_PREFIX.length))
}

/** The JPEG sits beside the original so its provenance is obvious. */
export function emailJpegPath(path: string): string {
  return `${path.replace(/\.[a-z0-9]+$/i, '')}-email.jpg`
}

async function collectJobs(): Promise<Job[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('content')
    .eq('audience_type', 'customer')
    .in('status', ['draft', 'scheduled'])

  if (error) throw new Error(error.message)

  const squares = new Set<string>()
  for (const row of (data ?? []) as Array<{ content: { blocks: Array<{ data?: { image?: { src?: string } } }> } }>) {
    for (const block of row.content.blocks) {
      const src = block.data?.image?.src
      if (src && src.includes(PUBLIC_PREFIX)) squares.add(storagePathFromUrl(src))
    }
  }

  // Landscapes for the events the September round-up lists, which needs 16:9 cards.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('landscape_image_url')
    .in('date', ['2026-09-16', '2026-09-18', '2026-09-25', '2026-09-30'])

  if (eventsError) throw new Error(eventsError.message)

  const landscapes = new Set<string>()
  for (const row of (events ?? []) as Array<{ landscape_image_url: string | null }>) {
    if (row.landscape_image_url?.includes(PUBLIC_PREFIX)) {
      landscapes.add(storagePathFromUrl(row.landscape_image_url))
    }
  }

  return [
    ...[...squares].sort().map((path) => ({ kind: 'square' as const, path })),
    ...[...landscapes].sort().map((path) => ({ kind: 'landscape' as const, path })),
  ]
}

/**
 * Storage calls fail intermittently with a bare "fetch failed" from undici, at a different
 * image each run, so every call gets a few attempts before it is treated as real.
 */
async function withRetry<T>(label: string, attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let tries = 1; tries <= 4; tries += 1) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      console.warn(`  retry ${tries}/4 after ${String(error)} on ${label}`)
      await new Promise((resolve) => setTimeout(resolve, tries * 1500))
    }
  }
  throw lastError
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const jobs = await collectJobs()
  console.warn(`${jobs.length} images to convert\n`)

  const apply = (() => {
    try {
      assertScriptMutationAllowed({
        scriptName: 'export-email-artwork-as-jpeg',
        envVar: 'RUN_EMAIL_ARTWORK_JPEG_MUTATION',
      })
      return true
    } catch {
      return false
    }
  })()

  let before = 0
  let after = 0

  for (const job of jobs) {
    const data = await withRetry(job.path, async () => {
      const result = await supabase.storage.from(BUCKET).download(job.path)
      if (result.error) throw new Error(result.error.message)
      return result.data
    })

    const original = Buffer.from(await data.arrayBuffer())
    // Twice the render width for retina, and never upscale a smaller source.
    const jpeg = await sharp(original)
      .resize({ width: RENDER_WIDTH[job.kind] * 2, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer()

    before += original.length
    after += jpeg.length

    const target = emailJpegPath(job.path)
    const saved = Math.round((1 - jpeg.length / original.length) * 100)
    console.warn(
      `${job.kind.padEnd(9)} ${(original.length / 1024 / 1024).toFixed(2)}MB -> ${(jpeg.length / 1024).toFixed(0)}KB  (${saved}% smaller)  ${target}`,
    )

    if (apply) {
      await withRetry(target, async () => {
        const result = await supabase.storage
          .from(BUCKET)
          .upload(target, jpeg, { contentType: 'image/jpeg', upsert: true })
        if (result.error) throw new Error(result.error.message)
        return result.data
      })
    }
  }

  console.warn(
    `\ntotal ${(before / 1024 / 1024).toFixed(1)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB, ${Math.round((1 - after / before) * 100)}% smaller`,
  )

  if (!apply) {
    console.warn('\nDry run. Set RUN_EMAIL_ARTWORK_JPEG_MUTATION=true to upload.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
