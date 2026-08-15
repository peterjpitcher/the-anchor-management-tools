import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { marketingContentSchema } from '../registry'
import { renderCampaignHtml } from '../render'
import { applyButtonCentring, findLeftAlignedButtonRows } from './buttonAlignment'
import { applyGoldContrastChange, findCharcoalOnGold } from './goldContrast'

/**
 * The block tests prove each piece is a faithful transcription. This proves the pieces go
 * back together into the designer's document: shell extraction, block order, the preview
 * wrapper strip, and every slot value in the campaign JSON, all at once.
 *
 * It currently passes. If you are reading this because it failed, you have changed the
 * output of the composed email, not discovered a flaky test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '..', '..', '..', '..', '..')
const FIXTURE_DIR = path.join(HERE, '..', 'blocks', '__fixtures__')

const CAMPAIGN_JSON = path.join(HERE, '..', 'campaigns', 'christmas-and-lunch-2026.json')
const HANDOVER_CAMPAIGN = path.join(
  REPO_ROOT,
  'docs/design/email-handover/anchor-christmas-and-lunch.html',
)
const HANDOVER_BLOCKS = path.join(REPO_ROOT, 'docs/design/email-handover/anchor-email-blocks.html')

/** See the note in `blocks.fidelity.test.ts`: duplicated so each fidelity file stands alone. */
function firstDifference(rendered: string, fixture: string): string {
  const limit = Math.min(rendered.length, fixture.length)
  let index = 0
  while (index < limit && rendered[index] === fixture[index]) index += 1

  if (index === limit && rendered.length === fixture.length) {
    return 'The rendered output and the handover file are identical.'
  }

  const describeChar = (value: string): string => {
    const char = value[index]
    if (char === undefined) return 'end of string'
    const code = char.codePointAt(0) ?? 0
    return `U+${code.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(char)}`
  }

  return [
    `First difference at character index ${index}.`,
    `Rendered length ${rendered.length}, handover length ${fixture.length}.`,
    `Both agree up to: ...${JSON.stringify(fixture.slice(Math.max(0, index - 80), index))}`,
    `Handover next: ${describeChar(fixture)} then ${JSON.stringify(fixture.slice(index, index + 80))}`,
    `Rendered next: ${describeChar(rendered)} then ${JSON.stringify(rendered.slice(index, index + 80))}`,
  ].join('\n')
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * The wording the designer shipped in the footer of the handover file.
 *
 * The campaign we actually send deliberately says more than this, because the original line
 * claims every recipient enquired with us and most of a prospecting list has not. This test
 * is about whether the RENDERER reproduces the designer's markup, so it compares using the
 * designer's own value and lets the shipped copy move on independently.
 */
const HANDOVER_REASON_FOR_CONTACT =
  'You are receiving this because you enquired about a booking or an event with us.'

const shippedContent = marketingContentSchema.parse(JSON.parse(readFileSync(CAMPAIGN_JSON, 'utf8')))

const campaignContent = {
  ...shippedContent,
  blocks: shippedContent.blocks.map((block) =>
    block.type === 'footer'
      ? { ...block, data: { ...block.data, reason_for_contact: HANDOVER_REASON_FOR_CONTACT } }
      : block,
  ),
}

describe('renderCampaignHtml, against the designer\'s own file', () => {
  it('rebuilds the Christmas campaign byte for byte, so what ships is what was signed off', () => {
    // Two documented departures, and only two. The footer copy above, because the designer's
    // line claims every recipient enquired with us, and the gold surfaces below, because the
    // owner asked for white text on gold. Both are applied to the designer's file rather than
    // relaxed in the comparison, so any third difference still fails this test.
    const expected = applyButtonCentring(applyGoldContrastChange(readFileSync(HANDOVER_CAMPAIGN, 'utf8')))
    const rendered = renderCampaignHtml(campaignContent)
    expect(rendered, firstDifference(rendered, expected)).toBe(expected)
  })

  it('puts white on every gold fill, so no charcoal-on-gold can creep back into a send', () => {
    expect(findCharcoalOnGold(renderCampaignHtml(campaignContent))).toEqual([])
    expect(findLeftAlignedButtonRows(renderCampaignHtml(campaignContent))).toEqual([])
  })

  it('is pure, so the same content renders identically twice with no clock or database in it', () => {
    // Stage one has to be deterministic or the fidelity comparison above means nothing.
    expect(renderCampaignHtml(campaignContent)).toBe(renderCampaignHtml(campaignContent))
  })

  it('leaves the unsubscribe placeholder alone, which is the delivery stage\'s job', () => {
    expect(renderCampaignHtml(campaignContent)).toContain('%%unsubscribe%%')
  })
})

describe('the extraction manifest', () => {
  const manifest = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as {
    generatedFrom: Record<string, { file: string; sha256: string }>
  }

  const RERUN =
    'The handover HTML no longer matches the file the fixtures were cut from. If the designer ' +
    'shipped new files, re-run scripts/one-off/extract-email-blocks.ts and review the fixture ' +
    'diff before trusting any fidelity test in this directory.'

  it('was cut from the campaign file that is still on disk, so the fixtures are not stale', () => {
    expect(sha256(HANDOVER_CAMPAIGN), RERUN).toBe(manifest.generatedFrom.campaign.sha256)
  })

  it('was cut from the block library file that is still on disk', () => {
    expect(sha256(HANDOVER_BLOCKS), RERUN).toBe(manifest.generatedFrom.blocks.sha256)
  })

  it('points at the paths the extraction script actually reads', () => {
    expect(manifest.generatedFrom.campaign.file).toBe(
      'docs/design/email-handover/anchor-christmas-and-lunch.html',
    )
    expect(manifest.generatedFrom.blocks.file).toBe(
      'docs/design/email-handover/anchor-email-blocks.html',
    )
  })
})
