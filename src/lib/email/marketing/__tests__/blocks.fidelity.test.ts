import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BLOCK_REGISTRY } from '../registry'

/**
 * This is the load-bearing test of the whole rendering layer.
 *
 * Every block module is a hand transcription of the designer's markup with slots cut into it.
 * A transcription cannot be reviewed by eye: the difference between a working email and a
 * broken one in Outlook is a single attribute, and nobody spots a missing `bgcolor` in a
 * 3,000 character table by reading it. So each module renders its own sample and is compared
 * against the extracted fixture byte for byte, and a one-character drift fails.
 *
 * The suite is driven off `BLOCK_REGISTRY` rather than a hand-written list, so a block added
 * next month is covered the moment it is registered and nobody has to remember this file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, '..', 'blocks', '__fixtures__')

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
}

/**
 * Builds the failure message.
 *
 * Vitest's own string diff is close to useless on a 3KB single line of table markup, and
 * "expected X to be Y" with two walls of HTML tells the reader nothing. This states the exact
 * character index and shows both sides from that point, which turns a ten minute squint into
 * a ten second fix.
 *
 * Deliberately duplicated in `campaign.fidelity.test.ts` so each fidelity file stands alone
 * and importing one never drags the other's suites into the run.
 */
function firstDifference(rendered: string, fixture: string): string {
  const limit = Math.min(rendered.length, fixture.length)
  let index = 0
  while (index < limit && rendered[index] === fixture[index]) index += 1

  if (index === limit && rendered.length === fixture.length) {
    return 'The rendered output and the fixture are identical.'
  }

  const describeChar = (value: string): string => {
    const char = value[index]
    if (char === undefined) return 'end of string'
    const code = char.codePointAt(0) ?? 0
    return `U+${code.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(char)}`
  }

  return [
    `First difference at character index ${index}.`,
    `Rendered length ${rendered.length}, fixture length ${fixture.length}.`,
    `Both agree up to: ...${JSON.stringify(fixture.slice(Math.max(0, index - 80), index))}`,
    `Fixture next:  ${describeChar(fixture)} then ${JSON.stringify(fixture.slice(index, index + 80))}`,
    `Rendered next: ${describeChar(rendered)} then ${JSON.stringify(rendered.slice(index, index + 80))}`,
  ].join('\n')
}

const entries = Object.entries(BLOCK_REGISTRY)
const cases = entries.map(([key, module]) => [key, module] as const)

describe('the block registry itself', () => {
  it('holds at least one block, so an empty registry cannot make this whole file vacuous', () => {
    // Without this, deleting every import from registry.ts would leave a green suite.
    expect(entries.length).toBeGreaterThan(0)
  })

  it('keys every block by its own type, because campaign JSON looks blocks up by that key', () => {
    const mismatched = entries.filter(([key, module]) => key !== module.type).map(([key]) => key)
    expect(mismatched).toEqual([])
  })
})

describe.each(cases)('the %s block', (_key, module) => {
  it('reproduces the designer\'s markup byte for byte, so a stray attribute cannot ship', () => {
    const fixture = readFixture(module.fixture)
    const rendered = module.render(module.sample)
    expect(rendered, firstDifference(rendered, fixture)).toBe(fixture)
  })

  it('accepts its own sample, so the catalogue preview cannot drift from the schema', () => {
    // `sample` is both the fidelity input and the preview data staff see in the block
    // catalogue. If it stops satisfying the schema, the catalogue breaks at render time.
    const parsed = module.schema.safeParse(module.sample)
    const reason = parsed.success ? '' : JSON.stringify(parsed.error.errors, null, 2)
    expect(parsed.success, reason).toBe(true)
  })

  it('produces a plain-text alternative, because a third of opens never render the HTML', () => {
    const text = module.text(module.sample)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
