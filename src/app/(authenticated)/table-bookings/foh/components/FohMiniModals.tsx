'use client'

import React from 'react'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'

type FohPartySizeModalProps = {
  open: boolean
  bookingActionInFlight: string | null
  partySizeEditValue: string
  onClose: () => void
  onPartySizeChange: (value: string) => void
  onConfirm: () => void
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit party size"
      size="sm"
      footer={
        <ModalActions>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(bookingActionInFlight)}
            onClick={onConfirm}
            className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:opacity-50"
          >
            {bookingActionInFlight === 'party_size' ? 'Saving...' : 'Confirm'}
          </button>
        </ModalActions>
      }
    >
      <label className="block text-sm font-medium text-gray-700">
        New party size
        <input
          type="number"
          min={1}
          max={50}
          value={partySizeEditValue}
          onChange={(e) => onPartySizeChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          autoFocus
        />
      </label>
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(bookingActionInFlight)}
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {bookingActionInFlight === 'walkout' ? 'Saving...' : 'Confirm'}
          </button>
        </ModalActions>
      }
    >
      <label className="block text-sm font-medium text-gray-700">
        Walkout amount
        <div className="relative mt-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-gray-500">£</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={walkoutAmountValue}
            onChange={(e) => onAmountChange(e.target.value)}
            className="w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm"
            placeholder="0.00"
            autoFocus
          />
        </div>
      </label>
    </Modal>
  )
})
