'use client'

import { TrashIcon } from '@heroicons/react/24/outline'
import { IconButton } from '@/ds'

interface VenueSpaceDeleteButtonProps {
  spaceName: string
  spaceId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VenueSpaceDeleteButton({ spaceName, spaceId, deleteAction }: VenueSpaceDeleteButtonProps) {
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="spaceId" value={spaceId} />
      <IconButton
        type="submit"
        label={`Delete ${spaceName}`}
        icon={<TrashIcon className="h-5 w-5" />}
        className="text-danger hover:text-danger-fg"
        onClick={(e) => {
          if (!confirm(`Are you sure you want to delete "${spaceName}"? This action cannot be undone.`)) {
            e.preventDefault()
          }
        }}
      />
    </form>
  )
}
