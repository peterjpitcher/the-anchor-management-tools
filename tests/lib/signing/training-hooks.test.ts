// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SigningDocumentRow, SigningKind } from '@/lib/signing/types'

/**
 * The signing feature tells training when one of its documents is confirmed or declined. The
 * training side is stood in for here; it is tested in tests/lib/training/signing.test.ts.
 */

const mocks = vi.hoisted(() => ({ completed: vi.fn(), declined: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('These hooks should not read the database themselves')
  },
}))
vi.mock('@/lib/training/signing', () => ({
  onTrainingSigningCompleted: mocks.completed,
  onTrainingSigningDeclined: mocks.declined,
}))

import { SIGNING_DECLINE_HOOKS, runCompletionHook, runDeclineHook } from '@/lib/signing/completion-hooks'

function documentOf(kind: SigningKind): SigningDocumentRow {
  // Cast: the hooks read the id and the kind.
  return { id: `doc-${kind}`, kind, status: 'completed', context: {} } as unknown as SigningDocumentRow
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.completed.mockResolvedValue(undefined)
  mocks.declined.mockResolvedValue(undefined)
})

describe('training hooks', () => {
  it('completes the training item for both training kinds', async () => {
    for (const kind of ['training_completion', 'training_signoff'] as const) {
      await runCompletionHook(documentOf(kind), [])
      expect(mocks.completed).toHaveBeenLastCalledWith(`doc-${kind}`)
    }
    expect(mocks.completed).toHaveBeenCalledTimes(2)
  })

  it('marks the training item declined for both training kinds, and does nothing for any other kind', async () => {
    expect(Object.keys(SIGNING_DECLINE_HOOKS).sort()).toEqual(['training_completion', 'training_signoff'])
    await runDeclineHook({ ...documentOf('training_signoff'), status: 'declined' })
    expect(mocks.declined).toHaveBeenCalledWith('doc-training_signoff')
    await runDeclineHook({ ...documentOf('employment_agreement'), status: 'declined' })
    expect(mocks.declined).toHaveBeenCalledTimes(1)
  })

  it('passes a training failure back, so the signing feature can raise it', async () => {
    mocks.completed.mockRejectedValue(new Error('training table unavailable'))
    await expect(runCompletionHook(documentOf('training_completion'), [])).rejects.toThrow('training table unavailable')
  })
})
