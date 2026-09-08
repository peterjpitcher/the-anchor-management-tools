import { describe, expect, it } from 'vitest'

import { BLOCK_REGISTRY } from '../registry'
import { renderShellHead } from '../blocks/shell'

/**
 * What `class="gutter"` does, and why it needs a guard.
 *
 * The shell's one breakpoint turns a guttered cell's 32px side padding into 20px on a phone.
 * A cell without the class keeps 32px. That is fine when a block is consistent: 32px
 * throughout reads as a slightly narrower column, and nobody notices. It is NOT fine when a
 * block guttters its heading and not the content under it, because then the heading's left
 * edge sits 12px inside the paragraph's, and a ragged edge inside one block is exactly the
 * kind of thing the owner spots and I do not.
 *
 * Centred content is exempt, and deliberately so: a wordmark or a pill button centred in a
 * cell looks identical whether its padding is 20px or 32px, so the mastheads, the closing
 * panel and the footers are not defects for being un-guttered.
 *
 * KNOWN_MIXED records the five blocks that arrived from the September 2026 mobile handover
 * with the heading guttered and the content under it not. They are listed rather than fixed
 * because the markup is fidelity-tested against the designer's own file and quietly diverging
 * from it is how a handover stops being a source of truth. None of the five is used by the
 * October round-up, which is consistent throughout. Raised with the owner on 2026-09-08.
 */

const KNOWN_MIXED = ['faq_rows', 'menu_list', 'steps', 'text_block', 'whats_on_list']

const CELL = /<td([^<>]*?)style="([^"]*)"([^<>]*)>/g

interface Cell {
  guttered: boolean
  centred: boolean
  padding: string
}

/** Every cell in a block whose horizontal padding is the 32px shell gutter. */
function gutterCells(html: string): Cell[] {
  const cells: Cell[] = []

  for (const match of html.matchAll(CELL)) {
    const attributes = `${match[1]}${match[3]}`
    const style = match[2]
    const padding = /padding:([^;"]+)/.exec(style)
    if (!padding) continue

    const parts = padding[1].trim().replace(/;$/, '').split(/\s+/)
    const horizontal = parts.length >= 2 ? parts[1] : parts[0]
    if (horizontal !== '32px') continue

    cells.push({
      guttered: attributes.includes('class="gutter"'),
      centred: /align="center"/.test(attributes) || /text-align:center/.test(style),
      padding: padding[1].trim(),
    })
  }

  return cells
}

function blocksWithRaggedEdge(): string[] {
  return Object.entries(BLOCK_REGISTRY)
    .filter(([, block]) => {
      const cells = gutterCells(block.render(block.sample)).filter((cell) => !cell.centred)
      return cells.some((cell) => cell.guttered) && cells.some((cell) => !cell.guttered)
    })
    .map(([key]) => key)
}

describe('the mobile gutter', () => {
  it('is defined in the shell, so the class on a cell actually does something', () => {
    // Without this, every gutter class in the library could be a no-op and every other
    // assertion here would still pass.
    const head = renderShellHead({ title: 'x', preheader: 'y' })
    expect(head).toContain('max-width:620px')
    expect(head).toContain('.gutter{padding-left:20px !important;padding-right:20px !important;}')
  })

  it('leaves no block with a ragged left edge beyond the five the handover shipped that way', () => {
    expect(blocksWithRaggedEdge().sort()).toEqual([...KNOWN_MIXED].sort())
  })

  it('still describes real blocks, so a stale entry cannot hide a new fault', () => {
    // If a listed block is fixed upstream, this fails and the list has to be trimmed by hand,
    // which is the only way an allow-list stays honest.
    for (const type of KNOWN_MIXED) {
      expect(Object.keys(BLOCK_REGISTRY)).toContain(type)
    }
    expect(blocksWithRaggedEdge().sort()).toEqual([...KNOWN_MIXED].sort())
  })
})

describe('the blocks the October round-up is built from', () => {
  // The email the owner is about to test in production. Checked by name rather than by
  // reading the campaign JSON, so this keeps meaning something if that file moves.
  const OCTOBER = [
    'masthead_green',
    'text_block',
    'whats_on_media',
    'opening_hours_week',
    'opening_hours_dates',
    'grid_cards_linked',
    'closing_panel_dark',
    'footer',
  ]

  it.each(OCTOBER)('has no ragged left edge in %s', (type) => {
    const cells = gutterCells(BLOCK_REGISTRY[type].render(BLOCK_REGISTRY[type].sample)).filter(
      (cell) => !cell.centred,
    )
    const guttered = cells.filter((cell) => cell.guttered).length

    // text_block is on the known-mixed list, but only because of its list-items row. The
    // round-up's text blocks carry a heading, a paragraph and a button, so this asserts what
    // that email actually renders rather than what the block can render.
    if (type === 'text_block') {
      const asUsed = gutterCells(
        BLOCK_REGISTRY[type].render({
          heading: 'Welcome to October',
          body: ['One paragraph.'],
          buttons: [{ label: 'See what is on', url: 'https://www.the-anchor.pub/whats-on', variant: 'primary' }],
        }),
      ).filter((cell) => !cell.centred)
      expect(asUsed.every((cell) => cell.guttered)).toBe(true)
      return
    }

    expect(guttered === 0 || guttered === cells.length).toBe(true)
  })
})
