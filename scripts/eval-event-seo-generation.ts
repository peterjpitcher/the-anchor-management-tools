// ──────────────────────────────────────────────────────────────
// Eval harness for event SEO generation fixtures.
//
// Usage:
//   npx tsx scripts/eval-event-seo-generation.ts
//   npm run eval:seo
//
// Set EVAL_LIVE=1 to include live OpenAI generation (not yet implemented).
// ──────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  buildEventSeoFacts,
  preflightCheck,
  type BuildFactsInput,
} from '../src/lib/event-seo/generation'
import { buildGenerationMessages } from '../src/lib/event-seo/prompts'

// ── Types ──────────────────────────────────────────────────────

type Fixture = {
  name: string
  description: string
  input: Partial<BuildFactsInput>
  expectedOutcome: 'pass' | 'fail'
  minimumScore: number | null
  notes: string
}

type TestResult = {
  fixture: string
  expected: 'pass' | 'fail'
  preflightPassed: boolean
  preflightErrors: string[]
  preflightWarnings: string[]
  messagesValid: boolean | null
  passed: boolean
  reason: string
}

// ── ANSI colours ───────────────────────────────────────────────

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

// ── Helpers ────────────────────────────────────────────────────

function loadFixtures(dir: string): Fixture[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf-8')
    return JSON.parse(raw) as Fixture
  })
}

function validateMessages(
  messages: Array<{ role: string; content: string }>
): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  if (messages.length !== 2) {
    issues.push(`Expected 2 messages (system + user), got ${messages.length}`)
  }

  if (messages[0]?.role !== 'system') {
    issues.push(`First message should be system, got ${messages[0]?.role}`)
  }

  if (messages[1]?.role !== 'user') {
    issues.push(`Second message should be user, got ${messages[1]?.role}`)
  }

  const systemContent = messages[0]?.content ?? ''
  if (!systemContent.includes('SEO content writer')) {
    issues.push('System message missing expected role description')
  }

  const userContent = messages[1]?.content ?? ''

  // Static sections should appear before dynamic FACTS_JSON
  const venueIdx = userContent.indexOf('VENUE CONTEXT')
  const rubricIdx = userContent.indexOf('QUALITY RUBRIC')
  const fieldIdx = userContent.indexOf('FIELD RULES:')
  const keywordIdx = userContent.indexOf('KEYWORD PLACEMENT RULES')
  const factsIdx = userContent.indexOf('FACTS_JSON:')

  if (factsIdx === -1) {
    issues.push('User message missing FACTS_JSON section')
  }

  if (venueIdx === -1) {
    issues.push('User message missing VENUE CONTEXT section')
  }

  // Verify static before dynamic ordering
  const staticSections = [venueIdx, rubricIdx, fieldIdx, keywordIdx].filter(
    (i) => i !== -1
  )
  if (factsIdx !== -1 && staticSections.some((i) => i > factsIdx)) {
    issues.push(
      'Static prompt sections should appear before dynamic FACTS_JSON'
    )
  }

  // Verify FACTS_JSON contains valid JSON
  if (factsIdx !== -1) {
    const jsonStart = userContent.indexOf('{', factsIdx)
    if (jsonStart === -1) {
      issues.push('FACTS_JSON section does not contain a JSON object')
    } else {
      // Find the matching closing brace
      let depth = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < userContent.length; i++) {
        if (userContent[i] === '{') depth++
        else if (userContent[i] === '}') {
          depth--
          if (depth === 0) {
            jsonEnd = i + 1
            break
          }
        }
      }
      if (jsonEnd === -1) {
        issues.push('FACTS_JSON section has unbalanced braces')
      } else {
        try {
          JSON.parse(userContent.slice(jsonStart, jsonEnd))
        } catch {
          issues.push('FACTS_JSON section does not contain valid JSON')
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

// ── Main ───────────────────────────────────────────────────────

function run(): void {
  const fixtureDir = join(
    __dirname,
    '..',
    'tasks',
    'fixtures',
    'event-seo-generation'
  )
  const fixtures = loadFixtures(fixtureDir)
  const isLive = process.env.EVAL_LIVE === '1'
  const results: TestResult[] = []

  console.log(
    `\n${BOLD}Event SEO Generation Eval${RESET}  ${DIM}(${fixtures.length} fixtures)${RESET}\n`
  )

  if (isLive) {
    console.log(
      `${YELLOW}EVAL_LIVE=1 — live generation placeholder active${RESET}\n`
    )
  }

  for (const fixture of fixtures) {
    const result: TestResult = {
      fixture: fixture.name,
      expected: fixture.expectedOutcome,
      preflightPassed: false,
      preflightErrors: [],
      preflightWarnings: [],
      messagesValid: null,
      passed: false,
      reason: '',
    }

    try {
      // Build facts from input
      const facts = buildEventSeoFacts(fixture.input as BuildFactsInput)

      // Run preflight
      const preflight = preflightCheck(facts)
      result.preflightPassed = preflight.pass
      result.preflightErrors = preflight.hardErrors
      result.preflightWarnings = preflight.softWarnings

      if (fixture.expectedOutcome === 'fail') {
        // Expected to fail preflight
        if (!preflight.pass) {
          result.passed = true
          result.reason = `Preflight correctly rejected: ${preflight.hardErrors.join('; ')}`
        } else {
          result.passed = false
          result.reason = 'Expected preflight failure but it passed'
        }
      } else {
        // Expected to pass
        if (!preflight.pass) {
          result.passed = false
          result.reason = `Preflight failed unexpectedly: ${preflight.hardErrors.join('; ')}`
        } else {
          // Verify prompt messages are well-formed
          const messages = buildGenerationMessages(facts)
          const messageCheck = validateMessages(messages)
          result.messagesValid = messageCheck.valid

          if (!messageCheck.valid) {
            result.passed = false
            result.reason = `Message validation failed: ${messageCheck.issues.join('; ')}`
          } else {
            if (isLive) {
              console.log(
                `  ${DIM}[${fixture.name}] Skipping live generation (placeholder)${RESET}`
              )
            }
            result.passed = true
            result.reason = 'Preflight passed, messages well-formed'
          }
        }
      }
    } catch (err) {
      result.passed = false
      result.reason = `Exception: ${err instanceof Error ? err.message : String(err)}`
    }

    results.push(result)

    // Print per-fixture result
    const icon = result.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    console.log(`  ${icon}  ${fixture.name}`)
    if (result.preflightWarnings.length > 0) {
      for (const w of result.preflightWarnings) {
        console.log(`       ${YELLOW}warn${RESET}: ${w}`)
      }
    }
    if (!result.passed) {
      console.log(`       ${RED}reason${RESET}: ${result.reason}`)
    }
  }

  // ── Summary table ──────────────────────────────────────────

  const totalPassed = results.filter((r) => r.passed).length
  const totalFailed = results.filter((r) => !r.passed).length

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${BOLD}Summary${RESET}`)
  console.log(`${'─'.repeat(60)}`)

  const colFixture = 30
  const colExpected = 10
  const colPreflight = 12
  const colResult = 8

  console.log(
    `${'Fixture'.padEnd(colFixture)}${'Expected'.padEnd(colExpected)}${'Preflight'.padEnd(colPreflight)}${'Result'.padEnd(colResult)}`
  )
  console.log(`${'─'.repeat(60)}`)

  for (const r of results) {
    const preflightLabel = r.preflightPassed
      ? `${GREEN}pass${RESET}`
      : `${RED}fail${RESET}`
    const resultLabel = r.passed
      ? `${GREEN}PASS${RESET}`
      : `${RED}FAIL${RESET}`
    const warningCount =
      r.preflightWarnings.length > 0
        ? ` ${YELLOW}(${r.preflightWarnings.length}w)${RESET}`
        : ''

    console.log(
      `${r.fixture.padEnd(colFixture)}${r.expected.padEnd(colExpected)}${(`${r.preflightPassed ? 'pass' : 'fail'}` + (r.preflightWarnings.length > 0 ? ` (${r.preflightWarnings.length}w)` : '')).padEnd(colPreflight + 4)}${r.passed ? 'PASS' : 'FAIL'}`
    )
  }

  console.log(`${'─'.repeat(60)}`)
  console.log(
    `${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : DIM}${totalFailed} failed${RESET} of ${results.length} fixtures\n`
  )

  process.exit(totalFailed > 0 ? 1 : 0)
}

run()
