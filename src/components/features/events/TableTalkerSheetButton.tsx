'use client'

import { useState } from 'react'
import { Button } from '@/ds'
import { Icon } from '@/ds/icons'
import { downloadTableTalkerSheet } from './tableTalkerSheet'

interface TableTalkerSheetButtonProps {
  eventId: string
  /** False until the table talker has been branded; the sheet only prints branded artwork. */
  branded: boolean
  className?: string
}

/** Saves the A4 sheet of three table talkers, for the event page's artwork card. */
export function TableTalkerSheetButton({
  eventId,
  branded,
  className,
}: TableTalkerSheetButtonProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      icon={<Icon name="download" size={14} />}
      loading={busy}
      disabled={!branded}
      title={branded ? 'Print at actual size (100%), then cut as needed.' : 'Brand the table talker first.'}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadTableTalkerSheet(eventId)
        } finally {
          setBusy(false)
        }
      }}
    >
      Print sheet (A4)
    </Button>
  )
}
