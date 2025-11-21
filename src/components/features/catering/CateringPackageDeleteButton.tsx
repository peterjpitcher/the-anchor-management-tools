'use client'

import { TrashIcon } from '@heroicons/react/24/outline'

interface CateringPackageDeleteButtonProps {
  packageName: string
  packageId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function CateringPackageDeleteButton({ packageName, packageId, deleteAction }: CateringPackageDeleteButtonProps) {
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="packageId" value={packageId} />
      <button
        type="submit"
        className="text-red-600 hover:text-red-700 transition-colors"
        onClick={(e) => {
          if (!confirm(`Are you sure you want to delete "${packageName}"? This action cannot be undone.`)) {
            e.preventDefault()
          }
        }}
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </form>
  )
}