// Client-side types and helpers for the FOH voucher page (spec section 4).
// Kept local so the page stays self-contained and safe to import from 'use client'
// components (no next/server or admin-client imports here).

import type { VoucherStatus } from '@/types/vouchers'

export interface FohStaffMember {
  id: string
  name: string
  clockedIn: boolean
}

export interface FohVoucherCounts {
  inStock: number
  out: number
  redeemedToday: number
}

export interface FohCustomerRef {
  id: string
  name: string
}

export interface FohVoucherLookupItem {
  number: string
  typeId: string
  typeTitle: string
  entitlementHtml: string
  status: VoucherStatus
  storedStatus: VoucherStatus
  ageDays: number | null
  ageLabel: string | null
  issuedAt: string | null
  issuedByName: string | null
  wonAtLabel: string | null
  expiryDate: string | null
  expiresInDays: number | null
  expiringSoon: boolean
  customer: FohCustomerRef | null
  alcohol: boolean
  requiresBooking: boolean
  valuePence: number | null
  redeemedAt: string | null
  redeemedByName: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  replacementNumber: string | null
  batchReady: boolean
}

export interface FohEventOption {
  id: string
  name: string
  date: string
  time: string | null
}

export interface FohEventBooker {
  customerId: string
  name: string
  seats: number
}

export interface FohMutationResult {
  ok: boolean
  networkError: boolean
  errorCode: string | null
  message: string | null
}

// ---------------------------------------------------------------------------
// London date helpers (client-safe, DST-proof: all maths on UTC date parts)
// ---------------------------------------------------------------------------

export function londonTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDaysToIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// '2026-10-28' -> '28 October 2026'
export function formatIsoDateLong(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) {
    return isoDate
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

// ISO timestamp -> '30 July, 2:15 pm' (London; hourCycle avoids the en-GB hour12 quirk)
export function formatLondonTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp
  }
  const dayPart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long'
  }).format(date)
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(date)
  return `${dayPart}, ${timePart}`
}

export function formatPounds(valuePence: number): string {
  const pounds = valuePence / 100
  return valuePence % 100 === 0 ? `£${pounds}` : `£${pounds.toFixed(2)}`
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `foh-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function fetchVoucherCounts(): Promise<FohVoucherCounts | null> {
  try {
    const response = await fetch('/api/foh/vouchers/summary')
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as { success?: boolean; data?: FohVoucherCounts }
    return body.success && body.data ? body.data : null
  } catch {
    return null
  }
}

export async function lookupVouchers(
  query: string
): Promise<{ items: FohVoucherLookupItem[] | null; message: string | null }> {
  try {
    const response = await fetch(`/api/foh/vouchers/lookup?q=${encodeURIComponent(query)}`)
    const body = (await response.json()) as {
      success?: boolean
      data?: FohVoucherLookupItem[]
      message?: string
      error?: string
    }
    if (response.ok && body.success && Array.isArray(body.data)) {
      return { items: body.data, message: null }
    }
    return { items: null, message: body.message || body.error || 'Lookup failed. Try again.' }
  } catch {
    return { items: null, message: 'Connection problem. Check the network and try again.' }
  }
}

export async function postVoucherAction(
  path: string,
  payload: Record<string, unknown>
): Promise<FohMutationResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const body = (await response.json().catch(() => null)) as {
      success?: boolean
      errorCode?: string
      message?: string
      error?: string
    } | null

    if (response.ok && body?.success) {
      return { ok: true, networkError: false, errorCode: null, message: null }
    }

    return {
      ok: false,
      networkError: false,
      errorCode: body?.errorCode ?? null,
      message: body?.message || body?.error || 'The action failed. Try again.'
    }
  } catch {
    return {
      ok: false,
      networkError: true,
      errorCode: null,
      message: 'Connection problem. Checking the voucher again...'
    }
  }
}

export async function fetchTodayEvents(): Promise<FohEventOption[]> {
  try {
    const response = await fetch('/api/foh/vouchers/events')
    if (!response.ok) {
      return []
    }
    const body = (await response.json()) as { success?: boolean; data?: FohEventOption[] }
    return body.success && Array.isArray(body.data) ? body.data : []
  } catch {
    return []
  }
}

export async function fetchEventBookers(eventId: string): Promise<FohEventBooker[]> {
  try {
    const response = await fetch(
      `/api/foh/vouchers/event-bookers?eventId=${encodeURIComponent(eventId)}`
    )
    if (!response.ok) {
      return []
    }
    const body = (await response.json()) as { success?: boolean; data?: FohEventBooker[] }
    return body.success && Array.isArray(body.data) ? body.data : []
  } catch {
    return []
  }
}

export async function searchCustomers(query: string): Promise<FohCustomerRef[]> {
  try {
    const response = await fetch(`/api/foh/customers/search?q=${encodeURIComponent(query)}`)
    if (!response.ok) {
      return []
    }
    const body = (await response.json()) as {
      success?: boolean
      data?: Array<{ id: string; full_name: string; display_phone: string | null }>
    }
    if (!body.success || !Array.isArray(body.data)) {
      return []
    }
    return body.data.map((row) => ({
      id: row.id,
      name: row.display_phone ? `${row.full_name} (${row.display_phone})` : row.full_name
    }))
  } catch {
    return []
  }
}

// Quick-add takes an optional email so voucher reminders can go out by email
// (preferred) rather than text. There is no consent tick: adding a customer this
// way grants all-communications consent server-side (see the route comment).
export async function quickAddCustomer(input: {
  name: string
  mobile: string
  email?: string
}): Promise<{ customer: FohCustomerRef | null; existing: boolean; message: string | null }> {
  try {
    const response = await fetch('/api/foh/vouchers/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    const body = (await response.json().catch(() => null)) as {
      success?: boolean
      data?: { id: string; name: string; existing: boolean }
      message?: string
      error?: string
    } | null

    if (response.ok && body?.success && body.data) {
      return {
        customer: { id: body.data.id, name: body.data.name },
        existing: body.data.existing,
        message: null
      }
    }
    return {
      customer: null,
      existing: false,
      message: body?.message || body?.error || 'Failed to add the customer'
    }
  } catch {
    return { customer: null, existing: false, message: 'Connection problem. Try again.' }
  }
}
