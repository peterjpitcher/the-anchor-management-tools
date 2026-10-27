'use client'

import { useRef, useState } from 'react'
import { Alert, Button, Checkbox, Field, Input, Modal, toast } from '@/ds'

export interface KitchenLoadSummary {
  /** What the kitchen counts now, from the database, or null when it counts nothing. */
  load: { covers: number; foodTime: string } | null
  /** Staff's own settings, null when automatic. */
  covers: number | null
  foodTime: string | null
  /** Events only: guests eat at this event. */
  foodServed?: boolean
}

interface KitchenLoadEditorProps {
  title: string
  summary: KitchenLoadSummary | null
  /** True when the page could not read the kitchen covers; said plainly rather than shown as none. */
  loadFailed?: boolean
  /** What counts when staff leave it automatic, in a sentence. */
  automaticRule: string
  /** Why nothing counts when nothing does, in a sentence. */
  emptyReason: string
  /** Events show a "Guests eat at this event" switch. */
  withFoodSwitch?: boolean
  canEdit: boolean
  save: (input: { foodServed: boolean; covers: string; foodTime: string }) => Promise<{ success?: boolean; error?: string }>
  onSaved: () => void
}

/**
 * The covers the kitchen cooks for a private hire or an event, and when (owner decision D29, review
 * BK-072). They count against the online food bookings for the arrival window around that time, so
 * a catered party does not leave the kitchen booked to its normal pace on top of the buffet.
 */
export function KitchenLoadEditor({
  title,
  summary,
  loadFailed,
  automaticRule,
  emptyReason,
  withFoodSwitch,
  canEdit,
  save,
  onSaved,
}: KitchenLoadEditorProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const [foodServed, setFoodServed] = useState(false)
  const [covers, setCovers] = useState('')
  const [foodTime, setFoodTime] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  if (loadFailed) {
    return (
      <Alert tone="warning" title={title}>
        We could not read the kitchen covers. Refresh the page before relying on the online food slots.
      </Alert>
    )
  }
  if (!summary) return null

  function openEditor(): void {
    setFoodServed(summary?.foodServed === true)
    setCovers(summary?.covers === null || summary?.covers === undefined ? '' : String(summary.covers))
    setFoodTime(summary?.foodTime ?? '')
    setError(null)
    setOpen(true)
  }

  async function handleSave(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const result = await save({ foodServed, covers, foodTime })
      if (!result.success) {
        const message = result.error ?? 'Nothing was saved.'
        setError(message)
        toast.error(message)
        return
      }
      toast.success('Kitchen covers saved.')
      setOpen(false)
      onSaved()
    } catch {
      const message = 'Nothing was saved: the request did not reach the server. Check your connection and try again.'
      setError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const staffSet = summary.covers !== null || summary.foodTime !== null
  const description = summary.load
    ? `The kitchen counts ${summary.load.covers} ${summary.load.covers === 1 ? 'cover' : 'covers'} at ${summary.load.foodTime}${staffSet ? ', as set by staff' : ''}. Online food bookings arriving around then are held back to make room.`
    : summary.covers === 0
      ? 'Staff set no kitchen covers, so online food bookings are not held back.'
      : emptyReason

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-default border border-border bg-surface p-3 text-sm">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-text">{title}</p>
          <p className="text-text-muted">{description}</p>
        </div>
        {canEdit && (
          <Button type="button" variant="secondary" size="sm" onClick={openEditor}>
            Change Kitchen Covers
          </Button>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title="Kitchen Covers"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} loading={pending} disabled={pending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text">{automaticRule}</p>
          {withFoodSwitch && (
            <Checkbox
              id="kitchen-food-served"
              label="Guests eat at this event"
              checked={foodServed}
              onChange={setFoodServed}
              disabled={pending}
            />
          )}
          {(!withFoodSwitch || foodServed) && (
            <>
              <Field label="Kitchen covers" hint="Leave blank to count automatically. Enter 0 if the kitchen cooks nothing.">
                <Input
                  id="kitchen-covers"
                  type="number"
                  min="0"
                  step="1"
                  value={covers}
                  onChange={(event) => setCovers(event.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label="Food goes out at" hint="Leave blank for the start time.">
                <Input
                  id="kitchen-food-time"
                  type="time"
                  value={foodTime}
                  onChange={(event) => setFoodTime(event.target.value)}
                  disabled={pending}
                />
              </Field>
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </>
  )
}
