'use client'

import { Button, Modal } from '@/ds'

export type VendorConfirmationPrompt = {
  name: string
  similar: Array<{ id: string; name: string }>
}

interface NewVendorDialogProps {
  /** The name that is not on the vendor list, with the existing vendors it might be. Null closes the dialog. */
  prompt: VendorConfirmationPrompt | null
  pending?: boolean
  /** The person picked an existing vendor instead. */
  onUseExisting: (vendorName: string) => void
  /** The person confirmed it is a new vendor. */
  onCreate: () => void
  onClose: () => void
}

/**
 * Asked before a vendor is added to the list. A typed name used to create a vendor without a
 * word, which is how "Oak Farm Gas Co" and "Oak Farm Gas Co Ltd" came to be two vendors.
 */
export function NewVendorDialog({ prompt, pending = false, onUseExisting, onCreate, onClose }: NewVendorDialogProps) {
  const similar = prompt?.similar ?? []

  return (
    <Modal
      open={Boolean(prompt)}
      onClose={onClose}
      title="New vendor"
      description={prompt ? `"${prompt.name}" is not on the vendor list.` : undefined}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onCreate} loading={pending}>
            Create New Vendor
          </Button>
        </>
      }
    >
      {similar.length > 0 ? (
        <div className="space-y-3">
          <p>
            It looks like a vendor you already have. Using the existing one keeps all of its payments together.
          </p>
          <ul className="space-y-2">
            {similar.map((vendor) => (
              <li key={vendor.id}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onUseExisting(vendor.name)}
                  disabled={pending}
                >
                  Use {vendor.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No similar vendor was found. Create it as a new vendor?</p>
      )}
    </Modal>
  )
}
