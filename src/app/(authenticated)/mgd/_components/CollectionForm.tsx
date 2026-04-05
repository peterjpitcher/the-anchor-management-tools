'use client'

import { useState } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { createCollection, updateCollection } from '@/app/actions/mgd'
import type { MgdCollection } from '@/app/actions/mgd'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface CollectionFormProps {
  /** Existing collection for edit mode; omit for create mode */
  collection?: MgdCollection
  /** Called after successful create/update */
  onSuccess: () => void
  /** Called to cancel / close */
  onCancel: () => void
  /** Whether the return period is locked (submitted/paid) */
  disabled?: boolean
}

export function CollectionForm({
  collection,
  onSuccess,
  onCancel,
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <FormGroup label="Collection Date" required>
        <Input
          type="date"
          value={collectionDate}
          onChange={(e) => setCollectionDate(e.target.value)}
          required
          disabled={disabled}
        />
      </FormGroup>

      <FormGroup label="Net Take" required>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={netTake}
          onChange={(e) => setNetTake(e.target.value)}
          leftElement={<span className="text-gray-500">£</span>}
          placeholder="0.00"
          required
          disabled={disabled}
        />
      </FormGroup>

      <FormGroup label="MGD Due (20%)">
        <Input
          type="text"
          value={formatCurrency(mgdAmount)}
          disabled
          aria-label="MGD amount (calculated)"
        />
      </FormGroup>

      <FormGroup label="VAT on Supplier" required>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={vatOnSupplier}
          onChange={(e) => setVatOnSupplier(e.target.value)}
          leftElement={<span className="text-gray-500">£</span>}
          placeholder="0.00"
          required
          disabled={disabled}
        />
      </FormGroup>

      <FormGroup label="Notes">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional notes..."
          disabled={disabled}
        />
      </FormGroup>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={saving}
          disabled={disabled || saving || !collectionDate || !netTake}
        >
          {isEdit ? 'Update Collection' : 'Record Collection'}
        </Button>
      </div>
    </form>
  )
}
