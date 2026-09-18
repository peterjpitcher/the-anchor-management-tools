'use client'

import React from 'react'
import { ChristmasCourseFields } from '@/components/features/table-bookings/ChristmasCourseFields'
import { Button, Input, Modal, ModalActions } from '@/ds'

type FohPartySizeModalProps = {
  bookingId?: string | null
  onCoursesChange?: (counts: number[] | undefined) => void
  open: boolean
  bookingActionInFlight: string | null
  partySizeEditValue: string
  onClose: () => void
  onPartySizeChange: (value: string) => void
  onConfirm: (value: string) => void
}

export const FohPartySizeModal = React.memo(function FohPartySizeModal(props: FohPartySizeModalProps) {
  const {
    open,
    bookingActionInFlight,
    partySizeEditValue,
    onClose,
    onPartySizeChange,
    onConfirm,
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
      <Input
        ref={inputRef}
        label="New party size"
        type="number"
        min={1}
        max={50}
        value={partySizeEditValue}
        onChange={(e) => onPartySizeChange(e.target.value)}
        className="min-h-touch"
        autoFocus
      />
      {open && props.bookingId && props.onCoursesChange ? <ChristmasCourseFields bookingId={props.bookingId} partySize={Number(partySizeEditValue)} onChange={props.onCoursesChange} /> : null}
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
}

export const FohWalkoutModal = React.memo(function FohWalkoutModal(props: FohWalkoutModalProps) {
  const {
    open,
    bookingActionInFlight,
    walkoutAmountValue,
    onClose,
    onAmountChange,
    onConfirm,
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
