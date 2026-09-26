'use client'

import { useEffect, useState } from 'react'
import { Alert, Input, Field, Textarea, toast } from '@/ds'
import { createCollection, updateCollection } from '@/app/actions/mgd'
import type { MgdCollection } from '@/app/actions/mgd'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** What the Modal footer needs to draw the submit button. */
export interface CollectionFormStatus {
  saving: boolean
  canSubmit: boolean
}

interface CollectionFormProps {
  /** Existing collection for edit mode; omit for create mode */
  collection?: MgdCollection
  /** Called after successful create/update */
  onSuccess: () => void
  /**
   * The form's id. The form sits in a Modal whose footer holds Cancel and the submit button, and
   * that submit button names the form with `form={formId}`.
   */
  formId: string
  /** Told when saving starts or stops and when the form becomes ready to submit. */
  onStatusChange?: (status: CollectionFormStatus) => void
  /** Whether the return period is locked (submitted/paid) */
  disabled?: boolean
}

export function CollectionForm({
  collection,
  onSuccess,
  formId,
  onStatusChange,
  disabled = false,
}: CollectionFormProps): React.ReactElement {
  const isEdit = !!collection

  const [collectionDate, setCollectionDate] = useState(
    collection?.collection_date ?? ''
  )
  const [netTake, setNetTake] = useState(
    collection ? String(collection.net_take) : ''
  )
  const [vatOnSupplier, setVatOnSupplier] = useState(
    collection ? String(collection.vat_on_supplier) : ''
  )
  const [notes, setNotes] = useState(collection?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const netTakeNum = parseFloat(netTake) || 0
  const mgdAmount = netTakeNum * 0.2
  const canSubmit = !disabled && !saving && Boolean(collectionDate) && Boolean(netTake)

  useEffect(() => {
    onStatusChange?.({ saving, canSubmit })
  }, [saving, canSubmit, onStatusChange])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const payload = {
        collection_date: collectionDate,
        net_take: parseFloat(netTake) || 0,
        vat_on_supplier: parseFloat(vatOnSupplier) || 0,
        notes: notes.trim() || null,
      }

      const result = isEdit
        ? await updateCollection({ id: collection!.id, ...payload })
        : await createCollection(payload)

      if ('error' in result) {
        setError(result.error)
        return
      }

      toast.success(isEdit ? 'Collection updated' : 'Collection recorded')
      onSuccess()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Collection Date" required>
        <Input
          type="date"
          value={collectionDate}
          onChange={(e) => setCollectionDate(e.target.value)}
          required
          disabled={disabled}
        />
      </Field>

      <Field label="Net Take" required>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={netTake}
          onChange={(e) => setNetTake(e.target.value)}
          icon={<span className="text-text-muted">£</span>}
          placeholder="0.00"
          required
          disabled={disabled}
        />
      </Field>

      <Field label="MGD Due (20%)">
        <Input
          type="text"
          value={formatCurrency(mgdAmount)}
          disabled
          aria-label="MGD amount (calculated)"
        />
      </Field>

      <Field label="VAT on Supplier" required>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={vatOnSupplier}
          onChange={(e) => setVatOnSupplier(e.target.value)}
          icon={<span className="text-text-muted">£</span>}
          placeholder="0.00"
          required
          disabled={disabled}
        />
      </Field>

      <Field label="Notes">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional notes..."
          disabled={disabled}
        />
      </Field>
    </form>
  )
}
