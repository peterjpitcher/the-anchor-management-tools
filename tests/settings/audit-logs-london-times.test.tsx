// Audit log times on the London clock, in both test zones.
//
// The time under each row and the Timestamp in the details panel used toLocaleTimeString() and
// toLocaleString() with no locale and no zone, so the server (en-US, UTC) printed US format an
// hour behind London during British Summer Time. The CSV file name used the UTC date, which is
// yesterday from 00:00 to 00:59 BST.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AuditLogsClient from '@/app/(authenticated)/settings/audit-logs/AuditLogsClient'
import type { AuditLog } from '@/types/database'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/settings/audit-logs',
}))

vi.mock('@/app/actions/auditLogs', () => ({
  listAuditLogs: vi.fn(),
}))

const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'

const log: AuditLog = {
  id: 'log-1',
  created_at: JUST_AFTER_MIDNIGHT_BST,
  user_email: 'manager@example.com',
  operation_type: 'update',
  resource_type: 'employee',
  resource_id: 'employee-1',
  operation_status: 'success',
  ip_address: null,
}

function renderLogs() {
  return render(
    <AuditLogsClient
      initialLogs={[log]}
      initialTotalCount={1}
      pageSize={50}
      initialPage={1}
      initialFilters={{
        operationType: '',
        resourceType: '',
        status: '',
        dateFrom: '',
        dateTo: '',
        userId: '',
        resourceId: '',
      }}
      initialError={null}
      availableUsers={[]}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('audit logs London times', () => {
  it('shows the row time on the London clock', () => {
    renderLogs()

    expect(screen.getByText('00:30:00')).toBeInTheDocument()
  })

  it('shows the details timestamp on the London clock in en-GB format', () => {
    renderLogs()

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(screen.getByText('02/10/2026, 00:30:00')).toBeInTheDocument()
  })

  it('names the CSV download after the London date', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
    // jsdom has no object URLs, and following the link is not what is under test.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:audit-logs') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    let downloadName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download
    })

    renderLogs()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(downloadName).toBe('audit-logs-2026-10-02.csv')
  })
})
