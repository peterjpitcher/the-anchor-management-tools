'use client'

import { TrashIcon } from '@heroicons/react/24/outline'

interface VenueSpaceDeleteButtonProps {
  spaceName: string
  spaceId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VenueSpaceDeleteButton({ spaceName, spaceId, deleteAction }: VenueSpaceDeleteButtonProps) {
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="spaceId" value={spaceId} />
      <button
        type="submit"
        className="text-red-600 hover:text-red-700 transition-colors"
        onClick={(e) => {
          if (!confirm(`Are you sure you want to delete "${spaceName}"? This action cannot be undone.`)) {
            e.preventDefault()
          }
        }}
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </form>
  )
}