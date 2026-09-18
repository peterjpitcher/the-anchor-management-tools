'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@/ds'
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
  const [quickEmail, setQuickEmail] = useState('')
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
      email: quickEmail.trim() || undefined
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
    setQuickEmail('')
    setStatusMessage(
      outcome.existing ? `Matched existing customer ${outcome.customer.name}` : `Added ${outcome.customer.name}`
    )
  }

  if (value) {
    return (
      <div>
        <span className="block text-sm font-medium text-text">Customer (optional)</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* The attached customer reads as a selected chip, like the Won at chips. */}
          <span className="inline-flex min-h-touch items-center rounded-pill border border-primary bg-primary-soft px-4 py-2 text-base font-medium text-primary-soft-fg">
            {value.name}
          </span>
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => onChange(null)}
              className="min-h-touch text-base"
            >
              Remove
            </Button>
          )}
        </div>
        <div aria-live="polite">
          {statusMessage && (
            <p role="status" className="mt-2 text-sm font-medium text-text">
              {statusMessage}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={`${idPrefix}-customer-search`} className="block text-sm font-medium text-text">
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
              className="min-h-touch rounded-pill border border-border bg-surface px-4 py-2 text-base text-text-muted hover:bg-surface-hover focus-visible:outline-hidden focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {booker.name}
              <span className="ml-1 text-sm text-text-muted">
                (booked, {booker.seats} {booker.seats === 1 ? 'seat' : 'seats'})
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2">
        <Input
          id={`${idPrefix}-customer-search`}
          type="text"
          autoComplete="off"
          placeholder="Search by name or mobile"
          value={searchTerm}
          disabled={disabled}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div aria-live="polite">
        {searchResults.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
            {searchResults.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(customer)
                    setSearchTerm('')
                    setSearchResults([])
                  }}
                  className="min-h-touch w-full px-4 py-2 text-left text-base text-text hover:bg-surface-hover focus-visible:outline-hidden focus-visible:shadow-ring-inset"
                >
                  {customer.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {statusMessage && (
          <p role="status" className="mt-2 text-sm font-medium text-text">
            {statusMessage}
          </p>
        )}
      </div>

      {!showQuickAdd ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={disabled}
          onClick={() => setShowQuickAdd(true)}
          className="mt-2 min-h-touch text-base"
        >
          Add a new customer
        </Button>
      ) : (
        <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${idPrefix}-quick-name`} className="mb-1 block text-sm font-medium text-text">
                Name
              </label>
              <Input
                id={`${idPrefix}-quick-name`}
                type="text"
                autoComplete="off"
                value={quickName}
                onChange={(event) => setQuickName(event.target.value)}
                className="h-12 text-base"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${idPrefix}-quick-mobile`} className="mb-1 block text-sm font-medium text-text">
                Mobile
              </label>
              <Input
                id={`${idPrefix}-quick-mobile`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={quickMobile}
                onChange={(event) => setQuickMobile(event.target.value)}
                className="h-12 text-base"
              />
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor={`${idPrefix}-quick-email`} className="mb-1 block text-sm font-medium text-text">
                Email (optional, best for reminders)
              </label>
              <Input
                id={`${idPrefix}-quick-email`}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={quickEmail}
                onChange={(event) => setQuickEmail(event.target.value)}
                className="h-12 text-base"
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-text">
            Adding someone here signs them up for updates from The Anchor, so please say so out loud.
            We will remind them about the voucher by email, or by text if they have no email address.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleQuickAdd}
              disabled={busy}
              className="min-h-touch text-base"
            >
              {busy ? 'Adding...' : 'Add customer'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => {
                setShowQuickAdd(false)
                setStatusMessage(null)
              }}
              disabled={busy}
              className="min-h-touch text-base"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
