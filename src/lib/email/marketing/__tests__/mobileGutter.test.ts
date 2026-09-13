import { describe, expect, it } from 'vitest'

import { renderShellHead } from '../blocks/shell'
import { BLOCK_REGISTRY } from '../registry'

/**
 * What `class="gutter"` does, and why it needs a guard.
 *
 * The shell's one breakpoint turns a guttered cell's 32px side padding into 20px on a phone.
 * A cell without the class keeps 32px. Mixing the two is the defect: a heading at 20px above
 * a paragraph at 32px leaves a ragged left edge that is invisible at 600px and obvious on a
 * phone, and it happens between neighbouring blocks as readily as inside one.
 *
 * The October 2026 handover finished the pass, so this file no longer carries an allow-list.
 * The rule is now absolute and the test says so: every left-aligned cell with 32px side
 * padding carries the class, in every block, with no exceptions.
 *
 * Centred content is genuinely exempt rather than merely tolerated. A wordmark or a pill
 * button centred in a cell looks identical at 20px or 32px, so the mastheads, the closing
 * panel and both footers correctly carry nothing, and adding it there would teach the next
 * reader that the rule is "put it everywhere".
 */

const CELL = /<td([^<>]*?)style="([^"]*)"([^<>]*)>/g

interface GutterCell {
  guttered: boolean
  centred: boolean
  padding: string
}

/** Every cell in a block whose horizontal padding is the 32px shell gutter. */
function gutterCells(html: string): GutterCell[] {
  const cells: GutterCell[] = []

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

const blocks = Object.entries(BLOCK_REGISTRY)

describe('the mobile gutter', () => {
  it('is defined in the shell, so the class on a cell actually does something', () => {
    // Without this, every gutter class in the library could be a no-op and every other
    // assertion in this file would still pass.
    const head = renderShellHead({ title: 'x', preheader: 'y' })
    expect(head).toContain('max-width:620px')
    expect(head).toContain('.gutter{padding-left:20px !important;padding-right:20px !important;}')
  })

  it('is on every left-aligned 32px cell in the whole library', () => {
    const offenders = blocks.flatMap(([key, block]) =>
      gutterCells(block.render(block.sample))
        .filter((cell) => !cell.centred && !cell.guttered)
        .map((cell) => `${key}: padding:${cell.padding}`),
    )

    expect(offenders).toEqual([])
  })

  it('leaves no block with a ragged left edge', () => {
    // Implied by the rule above, asserted separately because this is the failure a reader
    // actually sees, and a future exemption would have to break this one too.
    const ragged = blocks
      .filter(([, block]) => {
        const cells = gutterCells(block.render(block.sample)).filter((cell) => !cell.centred)
        return cells.some((cell) => cell.guttered) && cells.some((cell) => !cell.guttered)
      })
      .map(([key]) => key)

    expect(ragged).toEqual([])
  })

  it('finds real cells to check, so a broken matcher cannot make this file vacuous', () => {
    // If the regex stopped matching, every assertion above would pass over an empty list.
    const total = blocks.reduce(
      (count, [, block]) => count + gutterCells(block.render(block.sample)).length,
      0,
    )
    expect(total).toBeGreaterThan(40)
  })
})

describe('the blocks the October round-up is built from', () => {
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

  it.each(OCTOBER)('%s exists and is consistent at both widths', (type) => {
    const block = BLOCK_REGISTRY[type]
    expect(block, `${type} is not registered`).toBeTruthy()
    const cells = gutterCells(block.render(block.sample)).filter((cell) => !cell.centred)
    expect(cells.every((cell) => cell.guttered)).toBe(true)
  })
})

describe('the two hours tables, which stack rather than staying tabular', () => {
  it.each(['opening_hours_week', 'opening_hours_dates'])(
    '%s puts its values in stacking cells, so it is three columns on a desktop and folded on a phone',
    (type) => {
      const html = BLOCK_REGISTRY[type].render(BLOCK_REGISTRY[type].sample)
      // Two stacking cells per row: the first version was mobile-first and left the right
      // half of the 536px table empty at 600px, which is what the nesting fixed.
      expect((html.match(/class="stack"/g) ?? []).length).toBeGreaterThanOrEqual(14)
      expect(html).toContain('<table role="presentation" width="100%"')
    },
  )

  it('never lets a time break across two lines', () => {
    for (const type of ['opening_hours_week', 'opening_hours_dates']) {
      const html = BLOCK_REGISTRY[type].render(BLOCK_REGISTRY[type].sample)
      expect(html, type).toContain('white-space:nowrap')
    }
  })

  it('keeps the day and date column out of the stack, so a day can never separate from its hours', () => {
    for (const type of ['opening_hours_week', 'opening_hours_dates']) {
      const html = BLOCK_REGISTRY[type].render(BLOCK_REGISTRY[type].sample)
      const dayCells = html.match(/<td width="112"[^>]*>/g) ?? []
      expect(dayCells.length, type).toBeGreaterThan(0)
      expect(dayCells.every((cell) => !cell.includes('stack')), type).toBe(true)
    }
  })
})
