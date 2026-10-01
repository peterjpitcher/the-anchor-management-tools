// The three places the AI's work is put in front of a person: the notice of what it could not
// do, the suggested categories by vendor, and the rules the system suggests.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import { ReceiptAiStatusNotice } from '@/app/(authenticated)/receipts/_components/ui/ReceiptAiStatusNotice'
import {
  SuggestedCategoriesCard,
  summariseProposals,
} from '@/app/(authenticated)/receipts/_components/ui/SuggestedCategoriesCard'
import { RuleProposalsPanel, describeRuleProposal } from '@/app/(authenticated)/receipts/_components/ui/RuleProposalsPanel'
import type { CategoryProposal, CategoryProposalGroup } from '@/services/receipts/receiptAiReview'
import type { ReceiptRuleSuggestion } from '@/types/database'

const mocks = vi.hoisted(() => ({
  canManage: true,
  refresh: vi.fn(),
  retry: vi.fn(),
  acceptAll: vi.fn(),
  loadProposals: vi.fn(),
  approve: vi.fn(),
  approveMany: vi.fn(),
  decline: vi.fn(),
  loadSuggestions: vi.fn(),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.canManage }),
}))

vi.mock('@/app/actions/receipt-ai', () => ({
  retryFailedReceiptClassification: (...args: unknown[]) => mocks.retry(...args),
  acceptVendorCategoryProposals: (...args: unknown[]) => mocks.acceptAll(...args),
  getReceiptCategoryProposals: (...args: unknown[]) => mocks.loadProposals(...args),
}))

vi.mock('@/app/actions/receipts', () => ({
  approveReceiptRuleSuggestion: (...args: unknown[]) => mocks.approve(...args),
  approveReceiptRuleSuggestions: (...args: unknown[]) => mocks.approveMany(...args),
  declineReceiptRuleSuggestion: (...args: unknown[]) => mocks.decline(...args),
  getReceiptRuleSuggestionsPage: (...args: unknown[]) => mocks.loadSuggestions(...args),
}))

const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}

async function enabledButton(scope: ReturnType<typeof within> | typeof screen, name: string | RegExp): Promise<HTMLElement> {
  const button = await scope.findByRole('button', { name }, SLOW)
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), SLOW)
  return button
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of [mocks.retry, mocks.acceptAll, mocks.loadProposals, mocks.approve, mocks.approveMany, mocks.decline, mocks.loadSuggestions]) {
    mock.mockReset()
  }
  mocks.canManage = true
})

// ---------------------------------------------------------------------------
// What the AI could not do
// ---------------------------------------------------------------------------

describe('ReceiptAiStatusNotice', () => {
  it('shows nothing when there is nothing to say, or the figures could not be worked out', () => {
    const { container, rerender } = render(<ReceiptAiStatusNotice status={{ failed: 0, failedForGood: 0, payrollChecks: 0 }} />)
    expect(container.textContent).toBe('')

    rerender(<ReceiptAiStatusNotice status={null} />)
    expect(container.textContent).toBe('')
  })

  it('says how many transactions could not be classified, and how many were given up on', () => {
    render(<ReceiptAiStatusNotice status={{ failed: 3, failedForGood: 1, payrollChecks: 0 }} />)

    expect(screen.getByText('Some transactions could not be classified')).toBeTruthy()
    expect(screen.getByText(/could not classify 3 transactions/)).toBeTruthy()
    expect(screen.getByText(/1 of them has been given up on/)).toBeTruthy()
    expect(screen.queryByText(/wage/)).toBeNull()
  })

  it('says how many possible wage payments are waiting, and that nothing was sent for them', () => {
    render(<ReceiptAiStatusNotice status={{ failed: 0, failedForGood: 0, payrollChecks: 2 }} />)

    expect(screen.getByText('Possible wage payments to check')).toBeTruthy()
    expect(screen.getByText(/2 payments look like wages/)).toBeTruthy()
    expect(screen.getByText(/Nothing was sent to the AI for them/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('sends the failed ones again and says how many were queued', async () => {
    mocks.retry.mockResolvedValue({ success: true, queued: 3 })
    render(<ReceiptAiStatusNotice status={{ failed: 3, failedForGood: 3, payrollChecks: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.retry).toHaveBeenCalledTimes(1)
    expect(toasted()).toEqual(['Queued 3 transactions to be classified again'])
  })

  it('says so when they could not be queued, and does not pretend otherwise', async () => {
    mocks.retry.mockResolvedValue({ success: false, error: 'Failed to queue classification jobs' })
    render(<ReceiptAiStatusNotice status={{ failed: 1, failedForGood: 0, payrollChecks: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(toasted()).toEqual(['Failed to queue classification jobs']), SLOW)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('shows the notice to someone who cannot manage receipts, without the button', () => {
    mocks.canManage = false
    render(<ReceiptAiStatusNotice status={{ failed: 1, failedForGood: 0, payrollChecks: 0 }} />)

    expect(screen.getByText(/could not classify 1 transaction\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Suggested categories, by vendor
// ---------------------------------------------------------------------------

function proposal(index: number, overrides: Partial<CategoryProposal> = {}): CategoryProposal {
  return {
    transactionId: `tx-${index}`,
    transactionDate: '2026-09-15',
    details: `BT GROUP PLC ${index}`,
    amount: 20 + index,
    category: 'Telephone',
    noCategoryApplies: false,
    confidence: 90,
    reasoning: null,
    ...overrides,
  }
}

const BT_GROUP: CategoryProposalGroup = {
  vendorId: 'v-bt',
  vendorName: 'BT',
  proposals: [proposal(1), proposal(2), proposal(3, { category: null, noCategoryApplies: true })],
}

describe('summariseProposals', () => {
  it('counts each suggested category, the most common first', () => {
    expect(summariseProposals(BT_GROUP.proposals)).toBe('Telephone (2), No category applies (1)')
    expect(summariseProposals([])).toBe('')
  })
})

describe('SuggestedCategoriesCard', () => {
  it('shows nothing when there are no suggestions', () => {
    const { container } = render(<SuggestedCategoriesCard initialGroups={[]} />)
    expect(container.textContent).toBe('')
  })

  it('says so when the suggestions could not be loaded', () => {
    render(<SuggestedCategoriesCard initialGroups={[]} loadError="The suggested categories could not be loaded." />)

    expect(screen.getByText('Suggested categories could not be loaded')).toBeTruthy()
    expect(screen.getByText('The suggested categories could not be loaded.')).toBeTruthy()
  })

  it('lists each vendor with what accepting would write', () => {
    render(<SuggestedCategoriesCard initialGroups={[BT_GROUP]} />)

    expect(screen.getByText('BT')).toBeTruthy()
    expect(screen.getByText('3 transactions: Telephone (2), No category applies (1)')).toBeTruthy()
    expect(screen.getByText('BT GROUP PLC 1')).toBeTruthy()
    expect(screen.getByText('3 suggestions')).toBeTruthy()
  })

  it('shows the first five and the rest on request', () => {
    const big: CategoryProposalGroup = {
      ...BT_GROUP,
      proposals: Array.from({ length: 8 }, (_, index) => proposal(index + 1)),
    }
    render(<SuggestedCategoriesCard initialGroups={[big]} />)

    expect(screen.queryByText('BT GROUP PLC 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }))
    expect(screen.getByText('BT GROUP PLC 8')).toBeTruthy()
  })

  it('asks before accepting a vendor’s suggestions, and writes nothing until confirmed', async () => {
    render(<SuggestedCategoriesCard initialGroups={[BT_GROUP]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))

    const dialog = await screen.findByRole('dialog', {}, SLOW)
    expect(within(dialog).getByText(/Write the suggested category to 3 transactions for BT/)).toBeTruthy()
    expect(within(dialog).getByText(/undo this from Recent runs/)).toBeTruthy()
    expect(mocks.acceptAll).not.toHaveBeenCalled()
  })

  it('accepts on confirmation, reports what was left, and reloads the list', async () => {
    mocks.acceptAll.mockResolvedValue({ success: true, runId: 'run-1', accepted: 2, skippedChanged: 1, skippedLocked: 0 })
    mocks.loadProposals.mockResolvedValue({ groups: [] })
    render(<SuggestedCategoriesCard initialGroups={[BT_GROUP]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    const dialog = await screen.findByRole('dialog', {}, SLOW)
    fireEvent.click(await enabledButton(within(dialog), 'Accept all'))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.acceptAll).toHaveBeenCalledWith({ vendorId: 'v-bt' })
    expect(toasted()).toEqual(['Accepted 2 suggestions for BT. 1 had changed and were left.'])
    // The list is read again, and with nothing left the card goes.
    await waitFor(() => expect(screen.queryByText('Suggested categories')).toBeNull(), SLOW)
  })

  it('says what went wrong, and how many were written first', async () => {
    mocks.acceptAll.mockResolvedValue({ error: 'Accepting stopped part-way.', runId: 'run-1', accepted: 1 })
    mocks.loadProposals.mockResolvedValue({ groups: [BT_GROUP] })
    render(<SuggestedCategoriesCard initialGroups={[BT_GROUP]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    const dialog = await screen.findByRole('dialog', {}, SLOW)
    fireEvent.click(await enabledButton(within(dialog), 'Accept all'))

    await waitFor(() => expect(toasted()).toEqual(['Accepting stopped part-way. 1 were accepted before it stopped.']), SLOW)
  })
})

// ---------------------------------------------------------------------------
// Suggested rules
// ---------------------------------------------------------------------------

function suggestion(id: string, overrides: Partial<ReceiptRuleSuggestion> = {}): ReceiptRuleSuggestion {
  return {
    id,
    status: 'pending',
    suggested_name: `${id} auto-tag`,
    match_description: 'booker wholesale',
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    set_vendor_id: 'v-booker',
    set_vendor_name: 'Booker',
    set_expense_category: null,
    auto_status: 'pending',
    evidence_transaction_ids: ['tx-1', 'tx-2'],
    evidence: {
      kind: 'new_rule',
      transaction_count: 2,
      preview_match_count: 14,
      collision_count: 0,
      details_samples: ['BOOKER WHOLESALE STAINES 1', 'BOOKER WHOLESALE STAINES 2'],
    },
    approved_rule_id: null,
    declined_reason: null,
    created_at: '2026-10-01T09:00:00Z',
    reviewed_at: null,
    reviewed_by: null,
    ...overrides,
  }
}

function live(row: ReceiptRuleSuggestion, matchCount: number, collisions: number): ReceiptRuleSuggestion {
  return { ...row, evidence: { ...row.evidence, preview_match_count: matchCount, collision_count: collisions, checked_live: true } }
}

describe('describeRuleProposal', () => {
  it('reads what the suggestion would do from the evidence stored with it', () => {
    expect(describeRuleProposal(suggestion('s1'))).toEqual({
      kind: 'new_rule',
      targetRuleName: null,
      evidenceCount: 2,
      matchCount: 14,
      collisions: 0,
      samples: ['BOOKER WHOLESALE STAINES 1', 'BOOKER WHOLESALE STAINES 2'],
      checkedLive: false,
    })
  })

  it('copes with evidence from before the figures were stored', () => {
    expect(describeRuleProposal(suggestion('s1', { evidence: { ai_confidence: 90 } }))).toMatchObject({
      kind: 'new_rule',
      evidenceCount: 2,
      matchCount: null,
      collisions: 0,
      samples: [],
    })
  })

  it('knows a suggestion to add a category to an existing rule', () => {
    expect(
      describeRuleProposal(suggestion('s1', { evidence: { kind: 'add_category', target_rule_name: 'BT', transaction_count: 5 } }))
    ).toMatchObject({ kind: 'add_category', targetRuleName: 'BT', evidenceCount: 5 })
  })
})

describe('RuleProposalsPanel', () => {
  function renderPanel(rows: ReceiptRuleSuggestion[], options: { canGovern?: boolean; onEditFirst?: () => void } = {}) {
    return render(
      <RuleProposalsPanel
        initialSuggestions={rows}
        suggestionsTotal={rows.length}
        canGovernRules={options.canGovern ?? true}
        onEditFirst={options.onEditFirst ?? vi.fn()}
      />
    )
  }

  it('shows nothing when there are no suggestions, and checks nothing', () => {
    const { container } = renderPanel([])
    expect(container.textContent).toBe('')
    expect(mocks.loadSuggestions).not.toHaveBeenCalled()
  })

  it('checks every keyword against the transactions as they are now when it opens', async () => {
    const row = suggestion('s1')
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 16, 0)], suggestionsTotal: 1 })
    renderPanel([row])

    expect(mocks.loadSuggestions).toHaveBeenCalledWith(1, 20, { liveChecks: true })
    expect(await screen.findByText('matches 16 transactions', {}, SLOW)).toBeTruthy()
    expect(screen.getByText('booker wholesale')).toBeTruthy()
    expect(screen.getByText('Booker')).toBeTruthy()
    expect(screen.getByText('BOOKER WHOLESALE STAINES 1')).toBeTruthy()
    expect(screen.queryByText(/another vendor/)).toBeNull()
  })

  it('will not approve a suggestion whose keyword also matches another vendor', async () => {
    const row = suggestion('s1', { match_description: 'booker' })
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 20, 3)], suggestionsTotal: 1 })
    renderPanel([row])

    expect(await screen.findByText('3 belong to another vendor', {}, SLOW)).toBeTruthy()
    expect(screen.getByText(/cannot be approved as it stands/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Approve Disabled' }) as HTMLButtonElement).disabled).toBe(true)
    // It can still be declined, or edited into something more specific.
    expect((await enabledButton(screen, 'Decline'))).toBeTruthy()
    expect((await enabledButton(screen, 'Edit first'))).toBeTruthy()
    // And it cannot be swept up by "approve selected".
    expect(screen.queryByRole('checkbox', { name: /Select suggestion/ })).toBeNull()
  })

  it('approves one that is clear, and asks the page to reload', async () => {
    const row = suggestion('s1')
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 16, 0)], suggestionsTotal: 1 })
    mocks.approve.mockResolvedValue({ success: true })
    renderPanel([row])

    fireEvent.click(await enabledButton(screen, 'Approve'))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.approve).toHaveBeenCalledWith('s1', { active: true })
    expect(toasted()).toEqual(['Suggested rule approved'])
  })

  it('passes on the server’s refusal, and does not reload', async () => {
    const row = suggestion('s1')
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 16, 0)], suggestionsTotal: 1 })
    mocks.approve.mockResolvedValue({ error: 'A rule with the same match and result already exists: "Booker".' })
    renderPanel([row])

    fireEvent.click(await enabledButton(screen, 'Approve'))

    await waitFor(() => expect(toasted()).toEqual(['A rule with the same match and result already exists: "Booker".']), SLOW)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('puts a suggestion into the new rule form to be changed first', async () => {
    const row = suggestion('s1', { set_expense_category: 'Telephone' })
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 20, 3)], suggestionsTotal: 1 })
    const onEditFirst = vi.fn()
    renderPanel([row], { onEditFirst })

    fireEvent.click(await enabledButton(screen, 'Edit first'))

    expect(onEditFirst).toHaveBeenCalledWith({
      suggestedName: 's1 auto-tag',
      matchDescription: 'booker wholesale',
      direction: 'out',
      amountValue: 0,
      details: 'booker wholesale',
      setVendorName: 'Booker',
      setExpenseCategory: 'Telephone',
    })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('selects only the ones that can be approved', async () => {
    const clear = suggestion('clear')
    const clash = suggestion('clash', { match_description: 'booker' })
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(clear, 16, 0), live(clash, 20, 3)], suggestionsTotal: 2 })
    mocks.approveMany.mockResolvedValue({ approved: 1, failed: 0 })
    renderPanel([clear, clash])

    await screen.findByText('3 belong to another vendor', {}, SLOW)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all that can be approved' }))
    fireEvent.click(await enabledButton(screen, 'Approve Selected'))

    await waitFor(() => expect(mocks.approveMany).toHaveBeenCalledTimes(1), SLOW)
    expect(mocks.approveMany).toHaveBeenCalledWith(['clear'], { active: true })
  })

  it('describes a suggestion to add a category to a rule, with no keyword to edit', async () => {
    const row = suggestion('s1', {
      set_expense_category: 'Telephone',
      evidence: { kind: 'add_category', target_rule_name: 'BT line', transaction_count: 6 },
    })
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [row], suggestionsTotal: 1 })
    renderPanel([row])

    expect(await screen.findByText(/Add the category Telephone to the rule "BT line"/, {}, SLOW)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit first' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve Disabled' })).toBeNull()
  })

  it('shows the suggestions to someone who cannot approve them, without the buttons', async () => {
    const row = suggestion('s1')
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [live(row, 16, 0)], suggestionsTotal: 1 })
    renderPanel([row], { canGovern: false })

    expect(await screen.findByText('matches 16 transactions', {}, SLOW)).toBeTruthy()
    expect(screen.getByText(/Super admin approval is required/)).toBeTruthy()
    for (const name of ['Approve', 'Decline', 'Edit first']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('keeps the stored figures on screen, and says so, when the live check fails', async () => {
    const row = suggestion('s1')
    mocks.loadSuggestions.mockResolvedValue({ suggestions: [], suggestionsTotal: 0, error: 'Insufficient permissions' })
    renderPanel([row])

    await waitFor(() => expect(toasted()).toEqual(['Insufficient permissions']), SLOW)
    expect(screen.getByText('matches 14 transactions')).toBeTruthy()
    expect(screen.getByText('figures from when it was raised')).toBeTruthy()
  })
})
