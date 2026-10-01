import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Receipts audit entries must name the person who did the thing.
 *
 * The shared audit service records whatever it is given and looks nobody up, so every receipts
 * action that called `logAuditEvent` without a user wrote an anonymous row: 1,423 of the first
 * 1,429. The receipts actions now go through `logReceiptAudit(actor, ...)`, where the actor is a
 * required argument. This guard keeps a bare `logAuditEvent` call from creeping back in.
 */

const ROOT = process.cwd()

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('receipts audit entries name an actor', () => {
  const source = read('src/app/actions/receipts.ts')

  it('calls logAuditEvent in exactly one place, the helper that adds the actor', () => {
    const calls = [...source.matchAll(/\blogAuditEvent\(/g)]
    expect(calls).toHaveLength(1)

    const helperStart = source.indexOf('async function logReceiptAudit(')
    expect(helperStart).toBeGreaterThan(-1)
    const helperEnd = source.indexOf('\n}\n', helperStart)
    const helper = source.slice(helperStart, helperEnd)
    expect(helper).toContain('logAuditEvent({')
    expect(helper).toContain('user_id: actor.user_id')
  })

  it('passes an actor to every audit call', () => {
    const calls = [...source.matchAll(/\blogReceiptAudit\(([^,)]*)/g)].filter(
      // The helper's own declaration is not a call.
      (match) => !match[1].includes('actor: ReceiptActor') && match[1].trim() !== ''
    )
    expect(calls.length).toBeGreaterThanOrEqual(15)
    for (const call of calls) {
      expect(call[1].trim()).toBe('actor')
    }
  })

  it('audits every mutation that changes a payment, a rule or a file', () => {
    // One audit call, at least, in each of these exported actions.
    const audited = [
      'importReceiptStatement',
      'markReceiptTransaction',
      'updateReceiptNote',
      'updateReceiptClassification',
      'completeReceiptUpload',
      'deleteReceiptFile',
      'createReceiptRule',
      'updateReceiptRule',
      'toggleReceiptRule',
      'approveReceiptRuleSuggestion',
      'approveReceiptRuleSuggestions',
      'declineReceiptRuleSuggestion',
      'applyReceiptGroupClassification',
      'requeueUnclassifiedTransactions',
    ]
    const functions = source.split(/^(?=export async function )/m)
    for (const name of audited) {
      const body = functions.find((chunk) => chunk.startsWith(`export async function ${name}(`))
      expect(body, `${name} should exist`).toBeTruthy()
      expect(body, `${name} should write an audit entry`).toContain('logReceiptAudit(actor,')
    }
  })

  it('the shared helper adds the actor to every entry', () => {
    const helper = read('src/app/actions/receipt-audit.ts')
    expect(helper).not.toContain("'use server'")
    expect([...helper.matchAll(/\blogAuditEvent\(/g)]).toHaveLength(1)
    expect(helper).toContain('logAuditEvent({ ...event, user_id: actor.user_id')
  })

  it('the other receipts action files audit through the shared helper, with an actor', () => {
    const expected: Record<string, string[]> = {
      'receipt-vendors.ts': ['mergeReceiptVendors', 'renameReceiptVendor', 'undoReceiptVendorOperation', 'updateReceiptVendorDetails'],
      'receipt-rules.ts': ['previewReceiptRuleRun', 'applyReceiptRuleRunStep', 'undoReceiptRuleRunStep', 'setReceiptsLockDate', 'setReceiptRuleMatcher'],
      'receipt-ai.ts': ['decideReceiptAiCategory', 'acceptVendorCategoryProposals', 'retryFailedReceiptClassification'],
    }

    for (const [file, audited] of Object.entries(expected)) {
      const content = read(`src/app/actions/${file}`)
      // No direct call to the audit service: everything goes through the helper.
      expect([...content.matchAll(/\blogAuditEvent\(/g)], `${file} calls logAuditEvent directly`).toHaveLength(0)

      const calls = [...content.matchAll(/\blogReceiptActorAudit\(([^,)]*)/g)]
      expect(calls.length, `${file} writes no audit entries`).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call[1].trim(), `${file} passes something other than the actor`).toBe('actor')
      }

      const functions = content.split(/^(?=export async function )/m)
      for (const name of audited) {
        const body = functions.find((chunk) => chunk.startsWith(`export async function ${name}(`))
        expect(body, `${name} should exist in ${file}`).toBeTruthy()
        expect(body, `${name} should write an audit entry`).toContain('logReceiptActorAudit(actor,')
      }
    }
  })

  it('has no other receipts action file writing an audit entry without one', () => {
    // If a second receipts action module appears, it must follow the same pattern.
    const actionFiles = readdirSync(join(ROOT, 'src/app/actions')).filter(
      (name) => /receipt/i.test(name) && name.endsWith('.ts') && name !== 'receipts.ts' && name !== 'receipt-audit.ts'
    )
    for (const name of actionFiles) {
      const content = read(`src/app/actions/${name}`)
      const bare = [...content.matchAll(/\blogAuditEvent\(\{([^}]*)\}/g)].filter((match) => !match[1].includes('user_id'))
      expect(bare, `${name} has an audit call with no user_id`).toEqual([])
    }
  })
})
