import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The availability contract fixture must stay byte-identical in both repos.
 *
 * AMS produces the availability answer and the website consumes it. Both test
 * suites assert against a copy of the same fixture, which is only meaningful
 * while the two copies ARE the same file. Nothing enforced that: either side
 * could edit its own copy, watch its own tests go green, and ship a contract the
 * other end had never agreed to.
 *
 * A shared CI job is not available, because the repos do not build together. So
 * each repo pins the digest instead. Editing the fixture in one repo fails that
 * repo's own tests until the digest is updated, and updating the digest is the
 * moment you are reminded to copy the file across.
 *
 * TO CHANGE THE CONTRACT, do all three in the same change:
 *   1. Edit the fixture here and copy it to the website's
 *      tests/fixtures/table-availability-contract.json (byte for byte).
 *   2. Recompute:  shasum -a 256 <fixture>
 *   3. Update EXPECTED_CONTRACT_SHA256 in this file AND in the website's
 *      matching test.
 */

const EXPECTED_CONTRACT_SHA256 =
  '1b8814bb9839b5d096cf2983eac27d799f89191d0ba738e30cc41d5e1a4f5e3f'

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'table-availability-contract.json')

describe('table availability contract fixture', () => {
  it('matches the digest the website also pins', () => {
    const digest = createHash('sha256').update(readFileSync(FIXTURE_PATH)).digest('hex')

    expect(
      digest,
      'The availability contract fixture changed. Copy it to the website repo at ' +
        'tests/fixtures/table-availability-contract.json and update ' +
        'EXPECTED_CONTRACT_SHA256 in BOTH repos.'
    ).toBe(EXPECTED_CONTRACT_SHA256)
  })
})
