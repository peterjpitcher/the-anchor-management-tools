'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Modal, ModalActions, ConfirmModal } from '@/components/ui-v2/overlay/Modal'
import {
  createDestination,
  updateDestination,
  deleteDestination,
  type MileageDestination,
} from '@/app/actions/mileage'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline'

interface DestinationsClientProps {
  initialDestinations: MileageDestination[]
  canManage: boolean
}

export function DestinationsClient({
  initialDestinations,
  canManage,
}: DestinationsClientProps): React.JSX.Element {
  const [destinations, setDestinations] = useState(initialDestinations)
  const [isPending, startTransition] = useTransition()

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [editingDest, setEditingDest] = useState<MileageDestination | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MileageDestination | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Form fields
  const [name, setName] = useState('')
  const [postcode, setPostcode] = useState('')

  function openCreate(): void {
    setEditingDest(null)
    setName('')
    setPostcode('')
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(dest: MileageDestination): void {
    setEditingDest(dest)
    setName(dest.name)
    setPostcode(dest.postcode ?? '')
    setFormError(null)
    setShowForm(true)
  }

  function handleSubmit(): void {
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    startTransition(async () => {
      if (editingDest) {
        const result = await updateDestination({
          id: editingDest.id,
          name: name.trim(),
          postcode: postcode.trim() || undefined,
        })
        if (result.error) {
          setFormError(result.error)
          return
        }
        // Update local state
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === editingDest.id
              ? { ...d, name: name.trim(), postcode: postcode.trim() || null }
              : d
          )
        )
      } else {
        const result = await createDestination({
          name: name.trim(),
          postcode: postcode.trim() || undefined,
        })
        if (result.error) {
          setFormError(result.error)
          return
        }
        if (result.data) {
          setDestinations((prev) => [
            ...prev,
            {
              id: result.data!.id,
              name: name.trim(),
              postcode: postcode.trim() || null,
              isHomeBase: false,
              tripCount: 0,
              milesFromAnchor: null,
            },
          ].sort((a, b) => a.name.localeCompare(b.name)))
        }
      }
      setShowForm(false)
    })
  }

  function handleDelete(): void {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteDestination(deleteTarget.id)
      if (result.error) {
        setFormError(result.error)
        setDeleteTarget(null)
        return
      }
      setDestinations((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      setDeleteTarget(null)
    })
  }

  const nonHomeDestinations = destinations.filter((d) => !d.isHomeBase)
  const homeBase = destinations.find((d) => d.isHomeBase)

  return (
    <div className="space-y-4">
      {/* Header row */}
      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusIcon />}
            onClick={openCreate}
          >
            Add Destination
          </Button>
        </div>
      )}

      {/* Error banner */}
      {formError && !showForm && !deleteTarget && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {/* Home base card */}
      {homeBase && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <MapPinIcon className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-800">{homeBase.name}</span>
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Home Base
            </span>
            {homeBase.postcode && (
              <span className="text-sm text-green-600">{homeBase.postcode}</span>
            )}
          </div>
        </div>
      )}

      {/* Destinations table */}
      {nonHomeDestinations.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <MapPinIcon className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            No destinations saved yet. Add your first destination above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Postcode
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Miles from Anchor
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Trip Legs
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {nonHomeDestinations.map((dest) => (
                <tr key={dest.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {dest.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {dest.postcode ?? '\u2014'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                    {dest.milesFromAnchor != null ? `${dest.milesFromAnchor} mi` : '\u2014'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                    {dest.tripCount}
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Edit ${dest.name}`}
                          onClick={() => openEdit(dest)}
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Delete ${dest.name}`}
                          disabled={dest.tripCount > 0}
                          onClick={() => setDeleteTarget(dest)}
                        >
                          <TrashIcon className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingDest ? 'Edit Destination' : 'Add Destination'}
        size="sm"
        footer={
          <ModalActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowForm(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              loading={isPending}
            >
              {editingDest ? 'Save Changes' : 'Add Destination'}
            </Button>
          </ModalActions>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div>
            <label htmlFor="dest-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="dest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Costco"
              maxLength={200}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="dest-postcode" className="block text-sm font-medium text-gray-700 mb-1">
              Postcode
            </label>
            <Input
              id="dest-postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="e.g. TW16 5LN"
              maxLength={10}
            />
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Destination"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isPending}
      />
    </div>
  )
}
