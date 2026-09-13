import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  gridCardsLinked,
  gridCardsLinkedThreeSample,
} from '../blocks/grid_cards_linked'
import { BLOCK_REGISTRY } from '../registry'

/**
 * The fidelity suite is driven off `BLOCK_REGISTRY`, so it checks exactly one sample per
 * block. Two things fall through that gap and are picked up here.
 *
 * First, `grid_cards_linked` was drawn twice, two across and three across, and registered
 * once. The registry test proves the two-across sample; without this file the three-across
 * geometry could drift by a whole card width and nothing would fail.
 *
 * Second, the September 2026 blocks reproduce the handover's local placeholder path when a
 * slot has no artwork yet. That is right for a fixture and wrong for an inbox, so there is
 * a guard here that a real URL replaces it, and that no other block has quietly grown a
 * relative source.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, '..', 'blocks', '__fixtures__')

describe('the three-across variant of grid_cards_linked', () => {
  it('reproduces the designer\'s markup byte for byte, like the two-across one', () => {
    const fixture = readFileSync(path.join(FIXTURE_DIR, 'lib_grid_cards_linked_three.html'), 'utf8')
    const rendered = gridCardsLinked.render(gridCardsLinked.schema.parse(gridCardsLinkedThreeSample))
    expect(rendered).toBe(fixture)
  })

  it('rejects artwork drawn for the other row width, which is the fault it exists to stop', () => {
    // 258 is the two-across image width. In a row of three the slot is 166, so a 258 wide
    // image would render at one size and reserve space at another.
    const wrong = {
      cards: gridCardsLinkedThreeSample.cards.map((card) => ({
        ...card,
        image: { ...card.image, width: 258 },
      })),
    }
    const parsed = gridCardsLinked.schema.safeParse(wrong)
    expect(parsed.success).toBe(false)
  })

  it('rejects a row of one or four, because neither fills the 536px column', () => {
    const [card] = gridCardsLinkedThreeSample.cards
    expect(gridCardsLinked.schema.safeParse({ cards: [card] }).success).toBe(false)
    expect(gridCardsLinked.schema.safeParse({ cards: [card, card, card, card] }).success).toBe(false)
  })
})

/**
 * Blocks whose handover ships a local placeholder image, and the path each one carries.
 *
 * Listed rather than pattern-matched so a block that grows a new placeholder has to be
 * added here deliberately.
 */
const PLACEHOLDER_BLOCKS: ReadonlyArray<readonly [string, string]> = [
  ['whats_on_media', 'img/slot-16x9.png'],
  ['grid_cards_linked', 'img/slot-1x1.png'],
  ['media_row', 'img/slot-16x9.png'],
  ['two_up_cards', 'img/slot-1x1.png'],
]

describe('the designer\'s local placeholder artwork', () => {
  it.each(PLACEHOLDER_BLOCKS)('is what %s renders with an empty src, matching the handover', (type, placeholder) => {
    const block = BLOCK_REGISTRY[type]
    expect(block.render(block.sample)).toContain(`src="${placeholder}"`)
  })

  it.each(PLACEHOLDER_BLOCKS)('is replaced by a real URL in %s, so a send never carries it', (type) => {
    const block = BLOCK_REGISTRY[type]
    const hosted = 'https://www.the-anchor.pub/images/marketing/example.jpg'

    // Rebuild the sample with a hosted URL in every image slot it has.
    const withArtwork = JSON.parse(JSON.stringify(block.sample))
    const fill = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      if (typeof record.src === 'string' && typeof record.alt === 'string') record.src = hosted
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) value.forEach(fill)
        else fill(value)
      }
    }
    fill(withArtwork)

    const rendered = block.render(block.schema.parse(withArtwork))
    expect(rendered).toContain(`src="${hosted}"`)
    expect(rendered).not.toContain('src="img/')
  })
})

describe('every registered block', () => {
  it('keeps its image sources absolute unless it is a documented placeholder', () => {
    const placeholderTypes = new Set(PLACEHOLDER_BLOCKS.map(([type]) => type))

    const offenders = Object.entries(BLOCK_REGISTRY).flatMap(([type, block]) => {
      if (placeholderTypes.has(type)) return []
      return [...block.render(block.sample).matchAll(/src="(?!https?:\/\/)([^"]*)"/g)].map(
        (match) => `${type}: ${match[1]}`,
      )
    })

    expect(offenders).toEqual([])
  })
})
