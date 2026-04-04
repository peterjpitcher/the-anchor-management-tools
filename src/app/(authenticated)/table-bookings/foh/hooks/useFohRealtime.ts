'use client'

import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Manages ALL Supabase realtime channel subscriptions for the FOH schedule.
 * Keeps ref-based drag suppression together with the channels so that
 * realtime refreshes are suppressed while a drag is in flight.
 *
 * Also manages the 60-second polling fallback.
 */
export function useFohRealtime(input: {
  supabase: SupabaseClient
  date: string
  isDragging: boolean
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
}): void {
  const { supabase, date, isDragging, reloadSchedule } = input

  // Keep a ref in sync with isDragging so the realtime subscription callback
  // can check drag state without stale closure issues.
  const isDraggingRef = useRef(false)
  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  // Stable ref to reloadSchedule so the effect closure doesn't go stale.
  const reloadScheduleRef = useRef(reloadSchedule)
  useEffect(() => {
    reloadScheduleRef.current = reloadSchedule
  }, [reloadSchedule])

  // When drag ends, trigger a schedule refresh to pick up any server changes.
  const prevIsDraggingRef = useRef(false)
  useEffect(() => {
    if (prevIsDraggingRef.current && !isDragging) {
      void reloadScheduleRef.current?.({ requestedDate: date, surfaceError: false }).catch(() => {})
    }
    prevIsDraggingRef.current = isDragging
  }, [isDragging, date])

  useEffect(() => {
    let cancelled = false
    let refreshTimeoutId: number | null = null
    let pollIntervalId: number | null = null
    let channel: RealtimeChannel | null = null

    const queueRefresh = () => {
      if (cancelled) return
      // Suppress realtime refresh while a drag is in flight to avoid disrupting the drag ghost
      if (isDraggingRef.current) return
      if (refreshTimeoutId != null) {
        window.clearTimeout(refreshTimeoutId)
      }

      refreshTimeoutId = window.setTimeout(() => {
        refreshTimeoutId = null
        void reloadScheduleRef.current?.({ requestedDate: date, surfaceError: false }).catch(() => {
          // Best-effort realtime refresh; date-based loader handles surfaced errors.
        })
      }, 500)
    }

    channel = supabase
      .channel(`foh-schedule-live-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_bookings', filter: `booking_date=eq.${date}` },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booking_table_assignments' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_bookings' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_booking_items' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_space_table_areas' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_areas' },
        queueRefresh
      )
      .subscribe()

    pollIntervalId = window.setInterval(queueRefresh, 60_000)

    return () => {
      cancelled = true
      if (refreshTimeoutId != null) {
        window.clearTimeout(refreshTimeoutId)
      }
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId)
      }
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [date, supabase])
}
