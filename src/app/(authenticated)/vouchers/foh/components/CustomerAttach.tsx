'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  fetchEventBookers,
  quickAddCustomer,
  searchCustomers,
  type FohCustomerRef,
  type FohEventBooker
} from '../lib'

type CustomerAttachProps = {
  idPrefix: string
  value: FohCustomerRef | null
  onChange: (customer: FohCustomerRef | null) => void
  eventId?: string | null
  disabled?: boolean
}

// Optional customer attachment (spec 5.1): one-tap event-booker chips, existing
// FOH search-as-you-type, and the dedicated quick-add path (F16).
export function CustomerAttach({
  idPrefix,
  value,
  onChange,
  eventId = null,
  disabled = false
}: CustomerAttachProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<FohCustomerRef[]>([])
  const [bookers, setBookers] = useState<FohEventBooker[]>([])
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickMobile, setQuickMobile] = useState('')
  const [quickSmsOk, setQuickSmsOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!eventId) {
      setBookers([])
      return
    }
    fetchEventBookers(eventId).then((result) => {
      if (!cancelled) {
        setBookers(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [eventId])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    const term = searchTerm.trim()
    if (term.length < 2) {
      setSearchResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const results = await searchCustomers(term)
      setSearchResults(results)
    }, 300)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchTerm])

  async function handleQuickAdd() {
    if (busy) {
      return
    }
    if (!quickName.trim() || !quickMobile.trim()) {
      setStatusMessage('Enter a name and a mobile number')
      return
    }
    setBusy(true)
    setStatusMessage(null)
    const outcome = await quickAddCustomer({
      name: quickName.trim(),
      mobile: quickMobile.trim(),
      smsOk: quickSmsOk
    })
    setBusy(false)
    if (!outcome.customer) {
      setStatusMessage(outcome.message ?? 'Failed to add the customer')
      return
    }
    onChange(outcome.customer)
    setShowQuickAdd(false)
    setQuickName('')
    setQuickMobile('')
    setQuickSmsOk(true)
    setStatusMessage(
      outcome.existing ? `Matched existing customer ${outcome.customer.name}` : `Added ${outcome.customer.name}`
    )
  }

  if (value) {
    return (
      <div>
        <span className="block text-sm font-medium text-gray-900">Customer (optional)</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-[44px] items-center rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-base font-medium text-green-900">
            {value.name}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1"
            >
              Remove
            </button>
          )}
        </div>
        <div aria-live="polite">
          {statusMessage && (
            <p role="status" className="mt-2 text-sm font-medium text-gray-700">
              {statusMessage}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={`${idPrefix}-customer-search`} className="block text-sm font-medium text-gray-900">
        Customer (optional)
      </label>

      {bookers.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2" aria-label="Customers booked on this event">
          {bookers.map((booker) => (
            <button
              key={booker.customerId}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ id: booker.customerId, name: booker.name })}
              className="min-h-[44px] rounded-full border border-gray-300 bg-white px-4 py-2 text-base text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {booker.name}
              <span className="ml-1 text-sm text-gray-500">
                (booked, {booker.seats} {booker.seats === 1 ? 'seat' : 'seats'})
              </span>
            </button>
          ))}
        </div>
      )}

      <input
        id={`${idPrefix}-customer-search`}
        type="text"
        autoComplete="off"
        placeholder="Search by name or mobile"
        value={searchTerm}
        disabled={disabled}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="mt-2 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40 disabled:bg-gray-100"
      />

      <div aria-live="polite">
        {searchResults.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {searchResults.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(customer)
                    setSearchTerm('')
                    setSearchResults([])
                  }}
                  className="min-h-[44px] w-full px-4 py-2 text-left text-base text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sidebar/40"
                >
                  {customer.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {statusMessage && (
          <p role="status" className="mt-2 text-sm font-medium text-gray-700">
            {statusMessage}
          </p>
        )}
      </div>

      {!showQuickAdd ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowQuickAdd(true)}
          className="mt-2 min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add a new customer
        </button>
      ) : (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${idPrefix}-quick-name`} className="block text-sm font-medium text-gray-900">
                Name
              </label>
              <input
                id={`${idPrefix}-quick-name`}
                type="text"
                autoComplete="off"
                value={quickName}
                onChange={(event) => setQuickName(event.target.value)}
                className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${idPrefix}-quick-mobile`} className="block text-sm font-medium text-gray-900">
                Mobile
              </label>
              <input
                id={`${idPrefix}-quick-mobile`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={quickMobile}
                onChange={(event) => setQuickMobile(event.target.value)}
                className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
              />
            </div>
          </div>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-base text-gray-800">
            <input
              type="checkbox"
              checked={quickSmsOk}
              onChange={(event) => setQuickSmsOk(event.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-sidebar focus:ring-sidebar/40"
            />
            Happy to get a reminder text about this voucher
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={busy}
              className="min-h-[44px] rounded-lg bg-sidebar px-4 py-2 text-base font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Adding...' : 'Add customer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowQuickAdd(false)
                setStatusMessage(null)
              }}
              disabled={busy}
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
