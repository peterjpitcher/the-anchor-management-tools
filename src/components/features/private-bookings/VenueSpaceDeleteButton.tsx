'use client'

import { useRef, useState } from 'react'
import { ConfirmDialog, IconButton, Icon } from '@/ds'

interface VenueSpaceDeleteButtonProps {
  spaceName: string
  spaceId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VenueSpaceDeleteButton({ spaceName, spaceId, deleteAction }: VenueSpaceDeleteButtonProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [confirming, setConfirming] = useState(false)

  return (
    <form ref={formRef} action={deleteAction} className="inline">
      <input type="hidden" name="spaceId" value={spaceId} />
      <IconButton
        type="button"
        label={`Delete ${spaceName}`}
        icon={<Icon name="trash" size={20} />}
        className="text-danger hover:text-danger-fg"
        onClick={() => setConfirming(true)}
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => formRef.current?.requestSubmit()}
        title="Delete Space"
        message={`This removes "${spaceName}" from the spaces available for private hire. This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </form>
  )
}
