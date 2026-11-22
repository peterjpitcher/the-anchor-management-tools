'use client'

import React from 'react'
import { ChristmasCourseFields, type ChristmasPartyChange } from '@/components/features/table-bookings/ChristmasCourseFields'
import { Alert, Button, Input, Modal } from '@/ds'
import { FohPartySizeStepper } from './FohPartySizeStepper'
import { ModalActions } from '@/ds/compat'

type FohPartySizeModalProps = {
  bookingId?: string | null
  onCoursesChange?: (change: ChristmasPartyChange | undefined) => void
  open: boolean
  bookingActionInFlight: string | null
  partySizeEditValue: string
  onClose: () => void
  onPartySizeChange: (value: string) => void
  onConfirm: (value: string) => void
  /** Why the size was not accepted, shown here rather than on the page underneath. */
  error?: string | null
}

export const FohPartySizeModal = React.memo(function FohPartySizeModal(props: FohPartySizeModalProps) {
  const {
    open,
    bookingActionInFlight,
    partySizeEditValue,
    onClose,
    onPartySizeChange,
    onConfirm,
    error = null,
  } = props
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit party size"
      size="sm"
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" size="lg" onClick={onClose} className="min-h-touch">
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={Boolean(bookingActionInFlight)}
            onClick={() => onConfirm(inputRef.current?.value ?? partySizeEditValue)}
            className="min-h-touch"
          >
            {bookingActionInFlight === 'party_size' ? 'Saving...' : 'Confirm'}
          </Button>
        </ModalActions>
      }
    >
      {error && (
        <Alert tone="danger" size="sm" className="mb-3">
          {error}
        </Alert>
      )}
      <FohPartySizeStepper
        ref={inputRef}
        label="New party size"
        min={1}
        max={50}
        value={partySizeEditValue}
        onChange={onPartySizeChange}
      />
      {open && props.bookingId && props.onCoursesChange ? <ChristmasCourseFields bookingId={props.bookingId} partySize={Number(partySizeEditValue)} onChange={props.onCoursesChange} appearance="foh" /> : null}
    </Modal>
  )
})

type FohWalkoutModalProps = {
  open: boolean
  bookingActionInFlight: string | null
  walkoutAmountValue: string
  onClose: () => void
  onAmountChange: (value: string) => void
  onConfirm: () => void
  /** Why the amount was not accepted, shown here rather than on the page underneath. */
  error?: string | null
}

export const FohWalkoutModal = React.memo(function FohWalkoutModal(props: FohWalkoutModalProps) {
  const {
    open,
    bookingActionInFlight,
    walkoutAmountValue,
    onClose,
    onAmountChange,
    onConfirm,
    error = null,
  } = props

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Flag walkout"
      size="sm"
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" size="lg" onClick={onClose} className="min-h-touch">
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="lg"
            disabled={Boolean(bookingActionInFlight)}
            onClick={onConfirm}
            className="min-h-touch"
          >
            {bookingActionInFlight === 'walkout' ? 'Saving...' : 'Confirm'}
          </Button>
        </ModalActions>
      }
    >
      {error && (
        <Alert tone="danger" size="sm" className="mb-3">
          {error}
        </Alert>
      )}
      <Input
        label="Walkout amount"
        type="number"
        min={0.01}
        step={0.01}
        value={walkoutAmountValue}
        onChange={(e) => onAmountChange(e.target.value)}
        icon={<span className="text-ui text-text-muted">£</span>}
        className="min-h-touch"
        placeholder="0.00"
        autoFocus
      />
    </Modal>
  )
})
