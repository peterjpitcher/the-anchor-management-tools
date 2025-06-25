'use client'

import { TrashIcon } from '@heroicons/react/24/outline'

interface VendorDeleteButtonProps {
  vendorName: string
  vendorId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VendorDeleteButton({ vendorName, vendorId, deleteAction }: VendorDeleteButtonProps) {
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="vendorId" value={vendorId} />
      <button
        type="submit"
        className="text-red-600 hover:text-red-700 transition-colors"
        onClick={(e) => {
          if (!confirm(`Are you sure you want to delete "${vendorName}"? This action cannot be undone.`)) {
            e.preventDefault()
          }
        }}
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </form>
  )
}