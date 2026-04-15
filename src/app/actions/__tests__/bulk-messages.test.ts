import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Supabase mock — supports .rpc() and .auth.getUser()
// ---------------------------------------------------------------------------

const mockRpc = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      rpc: mockRpc,
    })
  ),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/sms-bulk-direct', () => ({
  sendBulkSMSDirect: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/app/actions/job-queue', () => ({
  enqueueBulkSMSJob: vi.fn().mockResolvedValue({ success: true, jobId: 'job-123' }),
}))

// ---------------------------------------------------------------------------
// Import modules under test — after mocks are registered
// ---------------------------------------------------------------------------

import { fetchBulkRecipients, sendBulkMessages } from '../bulk-messages'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER = { id: 'user-abc', email: 'staff@example.com' }

function setAuthUser(user: typeof MOCK_USER | null) {
  mockGetUser.mockResolvedValue({ data: { user } })
}

const MOCK_RECIPIENTS = [
  { id: 'cust-1', first_name: 'Alice', last_name: 'Smith', mobile_number: '+447700900001', last_booking_date: '2025-03-01' },
  { id: 'cust-2', first_name: 'Bob', last_name: 'Jones', mobile_number: '+447700900002', last_booking_date: null },
]

// ---------------------------------------------------------------------------
// fetchBulkRecipients
// ---------------------------------------------------------------------------

describe('fetchBulkRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAuthUser(MOCK_USER)
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    mockRpc.mockResolvedValue({ data: MOCK_RECIPIENTS, error: null })
  })

  it('should return error when user is not authenticated', async () => {
    setAuthUser(null)
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Unauthorized' })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('should return error when user lacks messages:send permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('should check permission with messages:send (not create or view)', async () => {
    await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(checkUserPermission).toHaveBeenCalledWith('messages', 'send', MOCK_USER.id)
  })

  it('should return recipients on success with default filters', async () => {
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ data: MOCK_RECIPIENTS })
  })

  it('should map filters correctly to RPC params', async () => {
    await fetchBulkRecipients({
      smsOptIn: 'opted_in',
      eventId: 'evt-1',
      bookingStatus: 'with_bookings',
      categoryId: 'cat-1',
      createdAfter: '2025-01-01',
      createdBefore: '2025-12-31',
      search: 'Alice',
    })

    expect(mockRpc).toHaveBeenCalledWith('get_bulk_sms_recipients', {
      p_event_id: 'evt-1',
      p_booking_status: 'with_bookings',
      p_sms_opt_in_only: true,
      p_category_id: 'cat-1',
      p_created_after: '2025-01-01',
      p_created_before: '2025-12-31',
      p_search: 'Alice',
    })
  })

  it('should set p_sms_opt_in_only to false when smsOptIn is "all"', async () => {
    await fetchBulkRecipients({ smsOptIn: 'all' })
    expect(mockRpc).toHaveBeenCalledWith(
      'get_bulk_sms_recipients',
      expect.objectContaining({ p_sms_opt_in_only: false })
    )
  })

  it('should pass null for undefined optional filters', async () => {
    await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(mockRpc).toHaveBeenCalledWith('get_bulk_sms_recipients', {
      p_event_id: null,
      p_booking_status: null,
      p_sms_opt_in_only: true,
      p_category_id: null,
      p_created_after: null,
      p_created_before: null,
      p_search: null,
    })
  })

  it('should escape % wildcard in search string', async () => {
    await fetchBulkRecipients({ smsOptIn: 'opted_in', search: '50% off' })
    expect(mockRpc).toHaveBeenCalledWith(
      'get_bulk_sms_recipients',
      expect.objectContaining({ p_search: '50\\% off' })
    )
  })

  it('should escape _ wildcard in search string', async () => {
    await fetchBulkRecipients({ smsOptIn: 'opted_in', search: 'some_thing' })
    expect(mockRpc).toHaveBeenCalledWith(
      'get_bulk_sms_recipients',
      expect.objectContaining({ p_search: 'some\\_thing' })
    )
  })

  it('should escape \\ in search string', async () => {
    await fetchBulkRecipients({ smsOptIn: 'opted_in', search: 'C:\\Users' })
    expect(mockRpc).toHaveBeenCalledWith(
      'get_bulk_sms_recipients',
      expect.objectContaining({ p_search: 'C:\\\\Users' })
    )
  })

  it('should return error when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Failed to fetch recipients: function does not exist' })
  })

  it('should return empty array when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ data: [] })
  })
})

// ---------------------------------------------------------------------------
// sendBulkMessages
// ---------------------------------------------------------------------------

describe('sendBulkMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAuthUser(MOCK_USER)
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(sendBulkSMSDirect).mockResolvedValue({ success: true })
    vi.mocked(enqueueBulkSMSJob).mockResolvedValue({ success: true, jobId: 'job-123' })
  })

  it('should return error when user is not authenticated', async () => {
    setAuthUser(null)
    const result = await sendBulkMessages(['cust-1'], 'Hello!')
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when user lacks messages:send permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const result = await sendBulkMessages(['cust-1'], 'Hello!')
    expect(result).toEqual({ success: false, error: 'Insufficient permissions' })
  })

  it('should check permission with messages:send', async () => {
    await sendBulkMessages(['cust-1'], 'Hello!')
    expect(checkUserPermission).toHaveBeenCalledWith('messages', 'send', MOCK_USER.id)
  })

  it('should return error when no recipients are provided', async () => {
    const result = await sendBulkMessages([], 'Hello!')
    expect(result).toEqual({ success: false, error: 'No recipients provided' })
    expect(sendBulkSMSDirect).not.toHaveBeenCalled()
    expect(enqueueBulkSMSJob).not.toHaveBeenCalled()
  })

  it('should call sendBulkSMSDirect for exactly 100 recipients (boundary)', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `cust-${i}`)
    await sendBulkMessages(ids, 'Hello!')
    expect(sendBulkSMSDirect).toHaveBeenCalledWith(ids, 'Hello!', undefined, undefined)
    expect(enqueueBulkSMSJob).not.toHaveBeenCalled()
  })

  it('should call sendBulkSMSDirect for <= 100 recipients', async () => {
    const ids = ['cust-1', 'cust-2', 'cust-3']
    await sendBulkMessages(ids, 'Hi there', 'evt-1', 'cat-1')
    expect(sendBulkSMSDirect).toHaveBeenCalledWith(ids, 'Hi there', 'evt-1', 'cat-1')
    expect(enqueueBulkSMSJob).not.toHaveBeenCalled()
  })

  it('should call enqueueBulkSMSJob for > 100 recipients', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `cust-${i}`)
    await sendBulkMessages(ids, 'Big send', 'evt-2')
    expect(enqueueBulkSMSJob).toHaveBeenCalledWith(ids, 'Big send', 'evt-2', undefined)
    expect(sendBulkSMSDirect).not.toHaveBeenCalled()
  })

  it('should return queued: false for direct send', async () => {
    const result = await sendBulkMessages(['cust-1'], 'Hello!')
    expect(result).toMatchObject({ success: true, queued: false, sent: 1 })
  })

  it('should return queued: true for enqueued send', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `cust-${i}`)
    const result = await sendBulkMessages(ids, 'Hello!')
    expect(result).toMatchObject({ success: true, queued: true, sent: 150 })
  })

  it('should return error when sendBulkSMSDirect fails', async () => {
    vi.mocked(sendBulkSMSDirect).mockResolvedValue({ error: 'Rate limit exceeded' })
    const result = await sendBulkMessages(['cust-1'], 'Hello!')
    expect(result).toEqual({ success: false, error: 'Rate limit exceeded' })
  })

  it('should return error when enqueueBulkSMSJob fails', async () => {
    vi.mocked(enqueueBulkSMSJob).mockResolvedValue({ error: 'Queue unavailable' })
    const ids = Array.from({ length: 101 }, (_, i) => `cust-${i}`)
    const result = await sendBulkMessages(ids, 'Hello!')
    expect(result).toEqual({ success: false, error: 'Queue unavailable' })
  })
})
