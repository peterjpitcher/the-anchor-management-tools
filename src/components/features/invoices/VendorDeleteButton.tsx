'use client'

import { IconButton, Icon } from '@/ds'

interface VendorDeleteButtonProps {
  vendorName: string
  vendorId: string
  deleteAction: (formData: FormData) => Promise<void>
}

export function VendorDeleteButton({ vendorName, vendorId, deleteAction }: VendorDeleteButtonProps) {
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="vendorId" value={vendorId} />
      <IconButton
        type="submit"
        label={`Delete ${vendorName}`}
        icon={<Icon name="trash" size={20} />}
        className="text-danger hover:text-danger-fg"
        onClick={(e) => {
          if (!confirm(`Are you sure you want to delete "${vendorName}"? This action cannot be undone.`)) {
            e.preventDefault()
          }
        }}
      />
    </form>
  )
}
