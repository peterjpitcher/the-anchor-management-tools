import { describe, expect, it } from 'vitest'

import { checkHouseStyle, houseStyleErrors } from '../house-style'

/**
 * The test set is not invented. Every string below is one that was actually live in this
 * database or on the website, which is the only way to know the checker catches the things
 * that really happen rather than the things I imagined might.
 */

const LIVE_FAULTS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'wellington-yorkshire',
    'Enjoy a golden puff pastry filled with beetroot and butternut squash, served with triple-cooked herb-crusted roast potatoes, a fluffy Yorkshire pudding, oven-roasted carrots and parsnips, buttery cabbage, and rich gravy.',
    'menu-cliche-opener',
  ],
  [
    'lamb-shank',
    'Savour our tender slow-braised lamb shank, served in a rich red wine gravy alongside herb and garlic-crusted roast potatoes.',
    'red-wine-gravy',
  ],
  ['brand-guidelines-1866', 'a British village pub with deep-rooted history dating back to 1866', 'founding-year'],
  ['drinks-flourish', 'Quintessentially British elegance in a glass. Premium gin infused with delicate elderflower.', 'flourish-word'],
]

describe('the faults that were actually live', () => {
  it.each(LIVE_FAULTS)('catches %s', (_name, text, expectedRule) => {
    const rules = checkHouseStyle(text).map((finding) => finding.rule)
    expect(rules).toContain(expectedRule)
  })

  it('catches the retired lamb as an error, not a nitpick', () => {
    const errors = houseStyleErrors(LIVE_FAULTS[1][1]).map((f) => f.rule)
    expect(errors).toContain('retired-dish')
    expect(errors).toContain('red-wine-gravy')
  })
})

describe('the difference between an error and a warning', () => {
  it('treats a banned factual claim as an error', () => {
    expect(houseStyleErrors('Serving Stanwell Moor since 1866.').map((f) => f.rule)).toEqual(['founding-year'])
  })

  it('treats a flourish word as a warning only, so it can never block a send', () => {
    expect(houseStyleErrors('An utterly iconic pint.')).toEqual([])
    expect(checkHouseStyle('An utterly iconic pint.').every((f) => f.severity === 'warning')).toBe(true)
  })

  it('catches the two flourish words SSOT §1 added in version 2.0', () => {
    const rules = checkHouseStyle('An elegant sensation.').map((f) => f.rule)
    expect(rules.filter((r) => r === 'flourish-word')).toHaveLength(2)
  })

  it('does not fire on "premium" alone, because the Tasting Night really is a premium spirit tasting', () => {
    // A checker that cries wolf on real copy gets switched off, which is worse than no checker.
    expect(checkHouseStyle('Premium spirit tasting with food pairings.')).toEqual([])
  })
})

describe('gluten free', () => {
  it('is an error in ordinary copy', () => {
    expect(houseStyleErrors('Our gluten-free bases are lovely.').map((f) => f.rule)).toEqual(['gluten-free'])
  })

  it('is allowed on the one page that holds the ranking', () => {
    expect(houseStyleErrors('gluten free pub food near Heathrow', { allowGlutenFreePhrase: true })).toEqual([])
  })
})

describe('the corrected Wellington', () => {
  const CORRECTED =
    'Golden puff pastry filled with beetroot and butternut squash, served with triple-cooked, ' +
    'herb-and-garlic crusted roast potatoes, oven-roasted carrots and parsnips and our vegan ' +
    'gravy. Fully vegan as it comes. Ask if you would like buttered cabbage or a Yorkshire ' +
    'pudding added, both of which make the plate no longer vegan.'

  it('raises no errors, which is the whole point of the exercise', () => {
    expect(houseStyleErrors(CORRECTED)).toEqual([])
  })

  it('is not flagged for saying "vegan" near "Wellington"', () => {
    // The rule bans "vegetarian" near Wellington. It must not misfire on the correct word.
    expect(checkHouseStyle(CORRECTED).map((f) => f.rule)).not.toContain('wellington-vegetarian')
  })
})

describe('prose checks', () => {
  it('flags a sentence over 25 words', () => {
    const long = `We ${'really '.repeat(26)}mean it.`
    expect(checkHouseStyle(long).map((f) => f.rule)).toContain('long-sentence')
  })

  it('allows one exclamation mark and objects to two', () => {
    expect(checkHouseStyle('Come along!').map((f) => f.rule)).not.toContain('exclamation-marks')
    expect(checkHouseStyle('Come along! Really!').map((f) => f.rule)).toContain('exclamation-marks')
  })

  it('can be turned off for a fragment like a dish name', () => {
    const name = `A ${'very '.repeat(30)}long dish name`
    expect(checkHouseStyle(name, { proseChecks: false }).map((f) => f.rule)).not.toContain('long-sentence')
  })
})

describe('claims retired on 10 September 2026', () => {
  // Every string here was live: on website pages, and in the Christmas set-menu rows in this app.
  it.each([
    ["Save £12.50 daily! We're outside London's ULEZ zone, perfect for travellers avoiding the charge.", 'ulez-figure'],
    ['Outside the ULEZ zone (saves London-based drivers £12.50).', 'ulez-figure'],
    ['The deposit is £250, fully deducted from your final bill.', 'private-hire-deposit-deducted'],
    ['Pre-book and pre-order only. Full dish list released closer to the time.', 'menu-released-later'],
  ])('treats "%s" as an error', (text, rule) => {
    expect(houseStyleErrors(text).map((f) => f.rule)).toContain(rule)
  })

  it('leaves the approved replacements alone', () => {
    expect(houseStyleErrors("We're outside the ULEZ zone, with 20 free parking spaces.")).toEqual([])
    expect(
      houseStyleErrors(
        "A £250 booking and damage deposit secures your date. It's held separately from your bill and refunded after the event, less any documented deductions."
      )
    ).toEqual([])
    expect(houseStyleErrors('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')).toEqual([])
  })
})

describe('the checker itself', () => {
  it('says nothing about empty text', () => {
    expect(checkHouseStyle('')).toEqual([])
    expect(checkHouseStyle('   ')).toEqual([])
  })

  it('finds every occurrence rather than stopping at the first', () => {
    // The rules carry the g flag and lastIndex is stateful; a shared regex would skip matches.
    const twice = 'Since 1866. And again in 1869.'
    expect(checkHouseStyle(twice).filter((f) => f.rule === 'founding-year')).toHaveLength(2)
  })

  it('gives the same answer when run twice on the same text', () => {
    const text = 'Indulge in our gluten-free lamb shank since 1866.'
    expect(checkHouseStyle(text)).toEqual(checkHouseStyle(text))
  })
})
