'use client'

import { useRef, useState } from 'react'
import { ConfirmDialog, IconButton, Icon } from '@/ds'

interface VendorDeleteButtonProps {
  vendorName: string
  vendorId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VendorDeleteButton({ vendorName, vendorId, deleteAction }: VendorDeleteButtonProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <form ref={formRef} action={deleteAction} className="inline">
      <input type="hidden" name="vendorId" value={vendorId} />
      <IconButton
        type="button"
        label={`Delete ${vendorName}`}
        icon={<Icon name="trash" size={20} />}
        className="text-danger hover:text-danger-fg"
        onClick={() => setConfirmOpen(true)}
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          // Submits the form to the server action exactly as the button did before the confirm step.
          formRef.current?.requestSubmit()
        }}
        title="Delete Vendor"
        message={`Are you sure you want to delete "${vendorName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </form>
  )
}
