'use client'

import React from 'react'
import { Modal, ModalActions } from '@/ds'
import { cn } from '@/lib/utils'
import type { TimeSlotOption } from '../utils'

const BLOCK_LABEL: Record<NonNullable<TimeSlotOption['blockedBy']>, string> = {
  private: 'Private',
  event: 'Event',
  taken: 'Taken',
}

/** Offered either side of the current time. Covers the everyday "they are running late" nudge. */
const NUDGE_STEPS = [-30, -15, 15, 30] as const

type FohChangeTimeModalProps = {
  open: boolean
  /** Who is being moved, for the heading. */
  bookingLabel: string
  currentTime: string
  /** True when the party is already at the table. Changes the warning, not the rules. */
  isSeated: boolean
  options: TimeSlotOption[]
  submitting: boolean
  /** Set on a refused move so the message lands inside the flow, not behind the modal. */
  error: string | null
  onClose: () => void
  onConfirm: (time: string) => void
}

export const FohChangeTimeModal = React.memo(function FohChangeTimeModal(props: FohChangeTimeModalProps) {
  const {
    open,
    bookingLabel,
    currentTime,
    isSeated,
    options,
    submitting,
    error,
    onClose,
    onConfirm,
  } = props

  const [selected, setSelected] = React.useState<string | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const currentRef = React.useRef<HTMLButtonElement | null>(null)

  // Reopening for another booking must not inherit the last one's choice.
  React.useEffect(() => {
    if (open) setSelected(null)
  }, [open, currentTime])

  // A 12-hour service is around 45 tiles. Without this the modal opens showing lunch while
  // the floor is working the evening.
  React.useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      // Guarded because scrollIntoView is not universally implemented and this is a nicety,
      // never a reason for the modal to fail to open.
      const node = currentRef.current
      if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, options])

  const byTime = React.useMemo(() => {
    const map = new Map<string, TimeSlotOption>()
    for (const option of options) map.set(option.time, option)
    return map
  }, [options])

  const currentOption = options.find((option) => option.isCurrent) ?? null

  const nudges = React.useMemo(() => {
    if (!currentOption) return []
    return NUDGE_STEPS.map((step) => {
      const target = options.find((option) => option.minutes === currentOption.minutes + step)
      return { step, option: target ?? null }
    })
  }, [currentOption, options])

  const selectedOption = selected ? byTime.get(selected) ?? null : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change booking time"
      size="md"
      footer={
        <ModalActions>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[44px] rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !selectedOption?.available}
            onClick={() => {
              if (selectedOption?.available) onConfirm(selectedOption.time)
            }}
            className="min-h-[44px] rounded-md bg-sidebar px-4 text-sm font-medium text-white hover:bg-sidebar/90 disabled:opacity-50"
          >
            {submitting
              ? 'Changing...'
              : selectedOption
                ? `Change to ${selectedOption.time}`
                : 'Change time'}
          </button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-semibold text-gray-900">{bookingLabel}</p>
          <p className="mt-0.5 text-sm text-gray-700">
            Currently booked for <strong>{currentTime}</strong>
          </p>
        </div>

        {/* Every change texts or emails the guest, so a mistap is not silent. Staff are told
            that before they pick, not after. */}
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {isSeated
            ? 'This party is already seated. Changing the time will still tell them their booking has moved, and will free their table for the old time.'
            : 'The guest is told about every time change.'}
        </p>

        {options.length === 0 ? (
          <p className="text-sm text-gray-500">
            No other time is available for this booking today.
          </p>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Quick change
              </p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {nudges.map(({ step, option }) => {
                  const usable = Boolean(option?.available)
                  const isSelected = Boolean(option && selected === option.time)
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={!usable || submitting}
                      aria-label={
                        option
                          ? `${step > 0 ? `${step} minutes later` : `${Math.abs(step)} minutes earlier`}, ${option.time}${usable ? '' : ', unavailable'}`
                          : `${step} minutes, unavailable`
                      }
                      onClick={() => option && setSelected(option.time)}
                      className={cn(
                        'flex min-h-[3.5rem] flex-col items-center justify-center rounded-lg border px-1 text-center',
                        'focus:outline-none focus:ring-2 focus:ring-green-500',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                        isSelected
                          ? 'border-green-600 bg-green-50 text-green-800'
                          : 'border-gray-300 text-gray-800 hover:bg-gray-50',
                      )}
                    >
                      <span className="text-sm font-semibold leading-tight">
                        {step > 0 ? `+${step}` : step}
                      </span>
                      <span className="mt-0.5 text-xs text-gray-500">
                        {option ? option.time : '--:--'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                All times
              </p>
              <div
                ref={gridRef}
                role="group"
                aria-label="Available booking times"
                className="mt-2 max-h-64 overflow-y-auto rounded-md border border-gray-200 p-2"
              >
                <div className="grid grid-cols-4 gap-2">
                  {options.map((option) => {
                    const isSelected = selected === option.time
                    return (
                      <button
                        key={option.time}
                        ref={option.isCurrent ? currentRef : undefined}
                        type="button"
                        disabled={!option.available || submitting}
                        aria-current={option.isCurrent ? 'true' : undefined}
                        aria-label={
                          option.isCurrent
                            ? `${option.time}, current booking time`
                            : option.available
                              ? option.time
                              : `${option.time}, unavailable, ${BLOCK_LABEL[option.blockedBy!].toLowerCase()}`
                        }
                        onClick={() => setSelected(option.time)}
                        className={cn(
                          'flex min-h-[3.5rem] flex-col items-center justify-center rounded-lg border px-1 text-center',
                          'focus:outline-none focus:ring-2 focus:ring-green-500',
                          'disabled:cursor-not-allowed',
                          option.isCurrent
                            ? 'border-gray-500 bg-gray-100 text-gray-900 opacity-100'
                            : isSelected
                              ? 'border-green-600 bg-green-50 text-green-800'
                              : option.available
                                ? 'border-gray-300 text-gray-800 hover:bg-gray-50'
                                : 'border-gray-200 text-gray-400 opacity-60',
                        )}
                      >
                        <span className="text-sm font-semibold leading-tight">{option.time}</span>
                        {option.isCurrent ? (
                          <span className="mt-0.5 text-[10px] font-medium text-gray-600">Current</span>
                        ) : option.blockedBy ? (
                          <span className="mt-0.5 text-[10px] text-gray-400">
                            {BLOCK_LABEL[option.blockedBy]}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
})
