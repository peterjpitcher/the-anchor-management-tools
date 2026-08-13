/**
 * Extracts the designer's email HTML into per-block fixtures.
 *
 * Two sources, two extraction strategies:
 *
 * 1. anchor-email-blocks.html carries explicit `<!-- BLOCK: name -->` markers, so those
 *    slices are found mechanically.
 * 2. anchor-christmas-and-lunch.html has no markers. Its slices are hand-chosen line
 *    ranges (CAMPAIGN_SLICES below). A hand-chosen boundary can be wrong, so the script
 *    proves the ranges tile the file exactly: every byte of the source belongs to exactly
 *    one slice, and concatenating the slices in order reproduces the file byte for byte.
 *    Without that proof a fixture and the template derived from it can agree with each
 *    other while both being wrong.
 *
 * Run: npx tsx scripts/one-off/extract-email-blocks.ts
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const HANDOVER_DIR = join(REPO_ROOT, 'docs', 'design', 'email-handover')
const OUT_DIR = join(REPO_ROOT, 'src', 'lib', 'email', 'marketing', 'blocks', '__fixtures__')

const CAMPAIGN_FILE = join(HANDOVER_DIR, 'anchor-christmas-and-lunch.html')
const BLOCKS_FILE = join(HANDOVER_DIR, 'anchor-email-blocks.html')

/**
 * Inclusive 1-indexed line ranges covering anchor-christmas-and-lunch.html.
 * Must tile the whole file with no gap and no overlap; the script enforces it.
 */
const CAMPAIGN_SLICES: Array<{ name: string; from: number; to: number }> = [
  { name: 'shell_head', from: 1, to: 30 },
  { name: 'masthead_green', from: 31, to: 32 },
  { name: 'hero_image', from: 33, to: 46 },
  { name: 'fact_strip', from: 47, to: 55 },
  { name: 'price_tiles', from: 56, to: 67 },
  { name: 'deadline_bar_campaign', from: 68, to: 68 },
  { name: 'divider_rule', from: 69, to: 70 },
  { name: 'section_intro', from: 71, to: 74 },
  { name: 'image_full', from: 75, to: 79 },
  { name: 'hours_table', from: 80, to: 88 },
  { name: 'cta_outline', from: 89, to: 92 },
  { name: 'amenity_grid', from: 93, to: 99 },
  { name: 'closing_panel_dark', from: 100, to: 107 },
  { name: 'signoff_ps_campaign', from: 108, to: 111 },
  { name: 'footer', from: 112, to: 117 },
  { name: 'shell_foot', from: 118, to: -1 },
]

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Character offset of the first character of each 1-indexed line, plus a terminating entry. */
function buildLineOffsets(source: string): number[] {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1)
  }
  offsets.push(source.length)
  return offsets
}

interface ExtractedSlice {
  name: string
  html: string
  startOffset: number
  endOffset: number
  sha256: string
}

function extractCampaign(source: string): ExtractedSlice[] {
  const offsets = buildLineOffsets(source)
  const lastLine = offsets.length - 2

  const slices = CAMPAIGN_SLICES.map((slice) => {
    const to = slice.to === -1 ? lastLine : slice.to
    if (slice.from < 1 || to > lastLine || to < slice.from) {
      throw new Error(`Slice ${slice.name} has an out-of-range line span ${slice.from}-${to}`)
    }
    const startOffset = offsets[slice.from - 1]
    const endOffset = to >= lastLine ? source.length : offsets[to]
    const html = source.slice(startOffset, endOffset)
    return { name: slice.name, html, startOffset, endOffset, sha256: sha256(html) }
  })

  // Tiling proof: contiguous, gapless, covering the whole file.
  let cursor = 0
  for (const slice of slices) {
    if (slice.startOffset !== cursor) {
      throw new Error(
        `Slice ${slice.name} starts at ${slice.startOffset} but the previous slice ended at ${cursor}. ` +
          'The line ranges do not tile the file.',
      )
    }
    cursor = slice.endOffset
  }
  if (cursor !== source.length) {
    throw new Error(`Slices cover ${cursor} of ${source.length} bytes. The tail of the file is unassigned.`)
  }
  const rebuilt = slices.map((slice) => slice.html).join('')
  if (rebuilt !== source) {
    throw new Error('Concatenated slices do not reproduce the campaign source byte for byte.')
  }

  return slices
}

function extractMarkedBlocks(source: string): ExtractedSlice[] {
  const pattern = /<!-- BLOCK: ([a-z_]+) -->([\s\S]*?)<!-- \/BLOCK: \1 -->/g
  const slices: ExtractedSlice[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    // Keep the inner markup only; the markers themselves are not part of the block.
    const html = match[2].replace(/^\n/, '').replace(/\n$/, '')
    slices.push({
      name: match[1],
      html,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      sha256: sha256(html),
    })
  }

  // Coverage check: no <table outside a marked block, so nothing structural was missed.
  let remainder = source
  for (const slice of [...slices].reverse()) {
    remainder = remainder.slice(0, slice.startOffset) + remainder.slice(slice.endOffset)
  }
  const strayTables = (remainder.match(/<table/g) || []).length
  if (strayTables > 0) {
    console.warn(
      `WARNING: ${strayTables} <table> element(s) in the blocks file sit outside any BLOCK marker. ` +
        'Check whether a block is missing its markers.',
    )
  }

  return slices
}

function main(): void {
  const campaignSource = readFileSync(CAMPAIGN_FILE, 'utf8')
  const blocksSource = readFileSync(BLOCKS_FILE, 'utf8')

  const campaignSlices = extractCampaign(campaignSource)
  const markedSlices = extractMarkedBlocks(blocksSource)

  mkdirSync(OUT_DIR, { recursive: true })

  const manifest = {
    generatedFrom: {
      campaign: { file: 'docs/design/email-handover/anchor-christmas-and-lunch.html', sha256: sha256(campaignSource) },
      blocks: { file: 'docs/design/email-handover/anchor-email-blocks.html', sha256: sha256(blocksSource) },
    },
    campaign: campaignSlices.map(({ name, startOffset, endOffset, sha256: hash }) => ({
      name,
      startOffset,
      endOffset,
      sha256: hash,
      fixture: `${name}.html`,
    })),
    library: markedSlices.map(({ name, startOffset, endOffset, sha256: hash }) => ({
      name,
      startOffset,
      endOffset,
      sha256: hash,
      fixture: `lib_${name}.html`,
    })),
  }

  for (const slice of campaignSlices) {
    writeFileSync(join(OUT_DIR, `${slice.name}.html`), slice.html, 'utf8')
  }
  for (const slice of markedSlices) {
    writeFileSync(join(OUT_DIR, `lib_${slice.name}.html`), slice.html, 'utf8')
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.warn(`Campaign slices: ${campaignSlices.length} (tiling proof passed)`)
  console.warn(`Library blocks:  ${markedSlices.length}`)
  console.warn(`Written to ${OUT_DIR}`)
}

main()
