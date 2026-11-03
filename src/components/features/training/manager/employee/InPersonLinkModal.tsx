'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Alert, Button, Input, Modal } from '@/ds'

interface InPersonLinkModalProps {
  /** The in-person confirmation address, or null when the modal is closed. */
  url: string | null
  employeeName: string
  onClose: () => void
}

function absolute(url: string): string {
  try {
    return new URL(url, window.location.origin).toString()
  } catch {
    return url
  }
}

/**
 * After a practical sign-off: the link the learner confirms on, in person. It is shown as a code
 * to scan on their own phone or a signed-out tablet, never opened here, because this browser is
 * signed in as the manager.
 */
export function InPersonLinkModal({ url, employeeName, onClose }: InPersonLinkModalProps): React.JSX.Element {
  const [qr, setQr] = useState<string | null>(null)
  const address = url ? absolute(url) : ''

  useEffect(() => {
    if (!url) {
      setQr(null)
      return
    }
    let cancelled = false
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(absolute(url), { margin: 1, width: 240 }))
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <Modal
      open={url !== null}
      onClose={onClose}
      title="Confirm In Person"
      description={`${employeeName} confirms the sign-off on their own phone or a signed-out tablet, with you beside them.`}
      footer={
        <Button type="button" variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">
          Do not hand over a device that is signed in to this app. Use their own phone, or a tablet that is signed out.
        </Alert>
        {qr ? (
          <Image src={qr} alt="Code to scan to open the confirmation screen" width={240} height={240} unoptimized className="mx-auto" />
        ) : null}
        <Input
          label="Or type this address into the other device"
          readOnly
          value={address}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    </Modal>
  )
}
