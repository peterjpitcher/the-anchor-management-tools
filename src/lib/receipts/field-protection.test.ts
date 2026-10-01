import { describe, expect, it } from 'vitest'
import {
  canAiWriteField,
  canAutomationChangeStatus,
  canInvoicePairingWriteField,
  canRuleWriteField,
} from './field-protection'

describe('receipt field protection', () => {
  it('lets a rule write only where nothing above it has decided', () => {
    expect(canRuleWriteField(null)).toBe(true)
    expect(canRuleWriteField(undefined)).toBe(true)
    expect(canRuleWriteField('')).toBe(true)
    expect(canRuleWriteField('ai')).toBe(true)
    expect(canRuleWriteField('rule')).toBe(true)

    expect(canRuleWriteField('manual')).toBe(false)
    expect(canRuleWriteField('ai_accepted')).toBe(false)
    expect(canRuleWriteField('import')).toBe(false)
    expect(canRuleWriteField('invoice')).toBe(false)
  })

  it('treats a source it has never heard of as protected', () => {
    // A new source added later must not be overwritable by default.
    expect(canRuleWriteField('something_new')).toBe(false)
    expect(canInvoicePairingWriteField('something_new')).toBe(false)
  })

  it('lets invoice pairing outrank rules and the AI, but not a person or the import', () => {
    expect(canInvoicePairingWriteField(null)).toBe(true)
    expect(canInvoicePairingWriteField('ai')).toBe(true)
    expect(canInvoicePairingWriteField('rule')).toBe(true)
    expect(canInvoicePairingWriteField('invoice')).toBe(true)

    expect(canInvoicePairingWriteField('manual')).toBe(false)
    expect(canInvoicePairingWriteField('ai_accepted')).toBe(false)
    expect(canInvoicePairingWriteField('import')).toBe(false)
  })

  it('lets the AI fill a blank and nothing else', () => {
    expect(canAiWriteField(null, null)).toBe(true)
    expect(canAiWriteField('', null)).toBe(true)

    // A value exists already.
    expect(canAiWriteField('Tesco', 'rule')).toBe(false)
    expect(canAiWriteField('Tesco', null)).toBe(false)
    // No value, but a person cleared it on purpose: that blank is a decision.
    expect(canAiWriteField(null, 'manual')).toBe(false)
    expect(canAiWriteField(null, 'rule')).toBe(false)
  })

  it('lets automation change the status of a pending payment only, and not one a person reopened', () => {
    expect(canAutomationChangeStatus({ status: 'pending', marked_method: null })).toBe(true)
    expect(canAutomationChangeStatus({ status: 'pending', marked_method: 'rule' })).toBe(true)
    expect(canAutomationChangeStatus({ status: 'pending' })).toBe(true)

    expect(canAutomationChangeStatus({ status: 'pending', marked_method: 'manual' })).toBe(false)
    for (const status of ['completed', 'auto_completed', 'no_receipt_required', 'cant_find']) {
      expect(canAutomationChangeStatus({ status, marked_method: null })).toBe(false)
    }
  })
})
