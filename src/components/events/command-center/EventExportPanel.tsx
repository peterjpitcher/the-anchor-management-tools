'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { getLocalIsoDateDaysAhead, getTodayIsoDate } from '@/lib/dateUtils'
import { toast } from '@/components/ui-v2/feedback/Toast'
import type { EventOverview } from '@/app/(authenticated)/events/get-events-command-center'

type ExportMode = 'all' | 'single'

interface EventExportPanelProps {
  events: EventOverview[]
}

function getFilenameFromHeaders(headers: Headers): string | null {
  const disposition = headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (!filenameMatch) return null
  return filenameMatch[1]
}

export default function EventExportPanel({ events }: EventExportPanelProps) {
  const [startDate, setStartDate] = useState(() => getTodayIsoDate())
  const [endDate, setEndDate] = useState(() => getLocalIsoDateDaysAhead(30))
  const [mode, setMode] = useState<ExportMode>('all')
  const [eventId, setEventId] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const rangeEvents = useMemo(() => {
    if (!startDate || !endDate) return events
    return events.filter((event) => event.date >= startDate && event.date <= endDate)
  }, [events, startDate, endDate])

  const selectedEvent = useMemo(() => rangeEvents.find((event) => event.id === eventId) ?? null, [rangeEvents, eventId])

  useEffect(() => {
    if (mode === 'single' && eventId && !selectedEvent) {
      setEventId('')
    }
  }, [eventId, mode, selectedEvent])

  const handleExport = async () => {
    if (!startDate || !endDate) {
      toast.error('Select both a start and end date to export events.')
      return
    }

    if (startDate > endDate) {
      toast.error('Start date must be before the end date.')
      return
    }

    if (mode === 'single') {
      if (!eventId) {
        toast.error('Choose an event to export.')
        return
      }

      if (!selectedEvent) {
        toast.error('Selected event is outside the chosen date range.')
        return
      }
    }

    setIsExporting(true)

    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      })

      if (mode === 'single' && eventId) {
        params.set('event_id', eventId)
      }

      const response = await fetch(`/api/events/export?${params.toString()}`)

      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? ''
        let message = 'Failed to export events.'

        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => null)
          if (data?.error) message = data.error
        } else {
          const text = await response.text().catch(() => '')
          if (text) message = text
        }

        throw new Error(message)
      }

      const blob = await response.blob()
      const filename =
        getFilenameFromHeaders(response.headers) ??
        `events_${startDate}_to_${endDate}${mode === 'single' ? '_single' : ''}.txt`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      toast.success('Event export downloaded.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export events.'
      toast.error(message)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[160px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="export-start-date">
              Start date
            </label>
            <input
              id="export-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            />
          </div>

          <div className="flex min-w-[160px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="export-end-date">
              End date
            </label>
            <input
              id="export-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            />
          </div>

          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="export-mode">
              Export scope
            </label>
            <select
              id="export-mode"
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as ExportMode
                setMode(nextMode)
                if (nextMode === 'all') setEventId('')
              }}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            >
              <option value="all">All events in range</option>
              <option value="single">Single event</option>
            </select>
          </div>

          {mode === 'single' && (
            <div className="flex min-w-[240px] flex-[2] flex-col gap-1">
              <label className="text-xs font-medium text-gray-500" htmlFor="export-event">
                Event
              </label>
              <select
                id="export-event"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              >
                <option value="">Select an event</option>
                {rangeEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.date} · {event.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            {isExporting ? 'Downloading...' : 'Download events'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Exports a .txt file with each event&#39;s brief, dates, times, status, and booking details.
      </p>
    </div>
  )
}
