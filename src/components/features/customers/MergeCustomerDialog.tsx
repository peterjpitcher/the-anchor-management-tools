'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Field, Modal, toast } from '@/ds'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { mergeCustomers, previewCustomerMerge } from '@/app/actions/customer-merge'
import { describeMergeCounts, type MergeCustomersOutcome } from '@/lib/customers/merge-summary'

type MergedOutcome = Extract<MergeCustomersOutcome, { state: 'merged' }>

type SelectedCustomer = {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string | null
}

interface MergeCustomerDialogProps {
  open: boolean
  onClose: () => void
  /** The duplicate: the record this page shows, which is folded into the one chosen. */
  customerId: string
  customerName: string
}

/**
 * "Merge into another record" on the customer page (BK-164).
 *
 * Staff pick the record to keep, see exactly what will move (the preview runs the merge and rolls
 * it back), then confirm. The kept record keeps its name and phone number; this one is anonymised.
 */
export function MergeCustomerDialog({ open, onClose, customerId, customerName }: MergeCustomerDialogProps) {
  const router = useRouter()
  const [target, setTarget] = useState<SelectedCustomer | null>(null)
  const [preview, setPreview] = useState<MergedOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [merging, setMerging] = useState(false)
  // The record the latest preview was asked for. A preview that comes back after staff picked a
  // different record is dropped, so the counts on screen are always for the record shown.
  const previewFor = useRef<string | null>(null)

  const targetName = target ? [target.first_name, target.last_name ?? ''].filter(Boolean).join(' ') : ''

  function reset() {
    previewFor.current = null
    setTarget(null)
    setPreview(null)
    setError(null)
  }

  function close() {
    if (merging) return
    reset()
    onClose()
  }

  async function checkMerge() {
    if (!target) return
    const keepId = target.id
    previewFor.current = keepId
    setChecking(true)
    setError(null)
    setPreview(null)
    try {
      const result = await previewCustomerMerge(customerId, keepId)
      if (previewFor.current !== keepId) return
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not work out what the merge would move. Try again.')
        return
      }
      setPreview(result.data)
    } catch {
      if (previewFor.current !== keepId) return
      setError('Could not work out what the merge would move. Try again.')
    } finally {
      if (previewFor.current === keepId) setChecking(false)
    }
  }

  // Only a preview of this exact pair can be confirmed: the merge cannot be undone.
  const previewMatches = Boolean(target && preview && preview.keep_id === target.id && preview.merge_id === customerId)

  async function confirmMerge() {
    if (!target || !preview || !previewMatches) return
    setMerging(true)
    setError(null)
    try {
      const result = await mergeCustomers(customerId, target.id)
      if (result.error || !result.data) {
        setError(result.error ?? 'The merge did not go through, and nothing was changed. Try again.')
        return
      }
      toast.success(`Merged into ${targetName}.`)
      const keepId = target.id
      reset()
      onClose()
      router.push(`/customers/${keepId}`)
    } catch {
      setError('The merge did not go through, and nothing was changed. Try again.')
    } finally {
      setMerging(false)
    }
  }

  const moved = describeMergeCounts(preview?.moved)
  const leftBehind = describeMergeCounts(preview?.left_behind)

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Merge ${customerName} into another record`}
      description="Use this when one guest has two records, for example after changing phone number."
      footer={
        <>
          <Button variant="secondary" type="button" onClick={close} disabled={merging}>
            Cancel
          </Button>
          {preview && previewMatches ? (
            <Button variant="danger" type="button" onClick={confirmMerge} loading={merging}>
              Merge into {targetName}
            </Button>
          ) : (
            <Button variant="primary" type="button" onClick={checkMerge} loading={checking} disabled={!target}>
              Check what moves
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Record to keep" hint="Its name and phone number stay. This record is emptied and marked as merged.">
          <CustomerSearchInput
            onCustomerSelect={(customer) => {
              previewFor.current = null
              setTarget(customer)
              setPreview(null)
              setError(null)
              setChecking(false)
            }}
            selectedCustomerId={target?.id ?? null}
            excludeCustomerIds={[customerId]}
            placeholder="Search by name or phone..."
          />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        {preview && previewMatches && (
          <div className="space-y-3 text-sm text-text">
            <div>
              <p className="font-medium">Moves to {targetName}:</p>
              {moved.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {moved.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-text-soft">Nothing else is linked to this record.</p>
              )}
            </div>
            {leftBehind.length > 0 && (
              <div>
                <p className="font-medium">Stays with this record, because {targetName} already has the same:</p>
                <ul className="mt-1 list-disc pl-5">
                  {leftBehind.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="list-disc pl-5 text-text-soft">
              {preview.email_moved && <li>{targetName} takes this record&apos;s email address.</li>}
              {preview.sms_opted_out && <li>Texts stay switched off: one of the records said STOP.</li>}
              <li>Any opt-out on either record applies to {targetName}. No opt-in is added.</li>
              <li>This record&apos;s notes are added to {targetName}&apos;s notes.</li>
            </ul>
            <p className="font-medium">This cannot be undone.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
