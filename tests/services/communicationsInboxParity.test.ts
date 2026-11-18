/**
 * The inbox now reads get_inbox_communications (one RPC) instead of two reads of
 * the customer_communications view. The SQL itself was compared with the view on
 * production by hand; this test pins the TypeScript side: given what the view
 * reads returned and what the function returns for the same data, getInbox must
 * build the same conversations, in the same order, with the same unread counts
 * and the same unreadIsCapped flag.
 *
 * `oldGetInboxReference` is a copy of the conversation-building loop as it was
 * before the change, fed the two view results the way they used to arrive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { CommunicationsService } from '@/services/communications'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

type Row = {
  id: string
  customer_id: string
  channel: 'sms' | 'whatsapp' | 'email' | 'feedback'
  direction: string
  created_at: string
  read_at: string | null
  staff_read_at: string | null
  has_attachments: boolean
  subject: string | null
  body_text: string | null
}

const RECENT_LIMIT = 250
const UNREAD_LIMIT = 500

function isUnreadRow(row: Row): boolean {
  if (row.direction !== 'inbound') return false
  if (row.channel === 'email') return !row.staff_read_at
  if (row.channel === 'sms' || row.channel === 'whatsapp') return !row.read_at
  return false
}

function newestFirst(a: Row, b: Row): number {
  const difference = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  if (difference !== 0) return difference
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** What the two old view reads returned. */
function oldViewReads(all: Row[]) {
  const sorted = [...all].sort(newestFirst)
  return {
    recent: sorted.slice(0, RECENT_LIMIT),
    unread: sorted.filter(isUnreadRow).slice(0, UNREAD_LIMIT),
  }
}

/** What get_inbox_communications returns for the same rows, shuffled to prove order is not trusted. */
function functionRows(all: Row[], seed: number) {
  const { recent, unread } = oldViewReads(all)
  const rows = [
    ...recent.map(row => ({ ...row, is_unread_row: false })),
    ...unread.map(row => ({ ...row, is_unread_row: true })),
  ]
  let state = seed
  for (let i = rows.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    const j = state % (i + 1)
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
  }
  return rows
}

function customerFor(id: string) {
  return {
    id,
    first_name: `First ${id}`,
    last_name: `Last ${id}`,
    mobile_number: null,
    email: null,
    sms_opt_in: true,
    whatsapp_opt_in: null,
    whatsapp_status: null,
  }
}

/** The pre-change conversation loop, verbatim in behaviour. */
function oldGetInboxReference(recentData: Row[], unreadData: Row[], unmatchedCount: number) {
  const rows = [...unreadData, ...recentData].map(row => ({ ...row, has_attachments: Boolean(row.has_attachments) }))
  const conversations = new Map<string, any>()
  const seenRows = new Set<string>()

  for (const row of rows) {
    if (seenRows.has(row.id)) continue
    seenRows.add(row.id)
    const customer = customerFor(row.customer_id)
    const current = conversations.get(customer.id)
    const unread = isUnreadRow(row) ? 1 : 0
    const lastMessage = {
      id: row.id,
      body: row.body_text,
      subject: row.subject,
      channel: row.channel,
      direction: row.direction,
      created_at: row.created_at,
      read_at: row.read_at,
      staff_read_at: row.staff_read_at,
      has_attachments: row.has_attachments,
    }
    if (!current) {
      conversations.set(customer.id, {
        customer,
        unreadCount: unread,
        channels: [row.channel],
        lastMessage,
        lastMessageAt: row.created_at,
      })
      continue
    }
    if (!current.channels.includes(row.channel)) current.channels.push(row.channel)
    current.unreadCount += unread
    if (new Date(row.created_at).getTime() >= new Date(current.lastMessageAt).getTime()) {
      current.lastMessage = lastMessage
      current.lastMessageAt = row.created_at
    }
  }

  const sorted = Array.from(conversations.values()).sort((a, b) => {
    const unreadDifference = Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
    if (unreadDifference !== 0) return unreadDifference
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  })
  const unreadIsCapped = unreadData.length >= UNREAD_LIMIT
  return {
    conversations: sorted,
    totalUnread: sorted.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    unreadIsCapped,
    hasMoreUnread: unreadIsCapped,
    unmatchedCount,
  }
}

function mockAdminClient(rpcData: unknown[], unmatchedCount: number) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }))
  const from = vi.fn((table: string) => {
    if (table === 'unmatched_communications') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: unmatchedCount, error: null })),
        })),
      }
    }
    if (table === 'customers') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async (_column: string, ids: string[]) => ({
            data: ids.map(customerFor),
            error: null,
          })),
        })),
      }
    }
    throw new Error(`Unexpected table read: ${table}`)
  })
  mockedCreateAdminClient.mockReturnValue({ rpc, from })
  return { rpc, from }
}

/** Unique timestamps, one minute apart, newest first by index 0. */
const BASE = Date.parse('2026-11-18T12:00:00.000Z')
function at(minutesAgo: number): string {
  return new Date(BASE - minutesAgo * 60_000).toISOString()
}

function row(partial: Partial<Row> & Pick<Row, 'id' | 'customer_id' | 'channel' | 'created_at'>): Row {
  return {
    direction: 'outbound',
    read_at: null,
    staff_read_at: null,
    has_attachments: false,
    subject: partial.channel === 'email' ? 'Subject' : null,
    body_text: `Body ${partial.id}`,
    ...partial,
  }
}

/**
 * 320 recent-ish rows across four channels and twelve customers (more than the
 * 250 window), some unread rows inside the window (so they sit in both lists),
 * and unread rows far older than the window (so only the unread list has them).
 */
function buildFixture(extraOldUnread: number): Row[] {
  const channels: Row['channel'][] = ['sms', 'email', 'whatsapp', 'feedback']
  const rows: Row[] = []
  for (let i = 0; i < 320; i += 1) {
    const channel = channels[i % channels.length]
    const customer = `c${(i * 7) % 12}`
    const inbound = i % 3 === 0 || channel === 'feedback'
    const unreadInWindow = inbound && i % 9 === 0
    rows.push(
      row({
        id: `${channel}:${String(i).padStart(4, '0')}`,
        customer_id: customer,
        channel,
        direction: inbound ? 'inbound' : 'outbound',
        created_at: at(i),
        read_at: channel === 'sms' || channel === 'whatsapp' ? (unreadInWindow ? null : at(i - 1)) : null,
        staff_read_at:
          channel === 'email'
            ? unreadInWindow ? null : at(i - 1)
            : channel === 'sms' || channel === 'whatsapp'
              ? inbound && !unreadInWindow ? at(i - 1) : null
              : null,
        has_attachments: i % 11 === 0,
      }),
    )
  }
  for (let k = 0; k < extraOldUnread; k += 1) {
    const channel: Row['channel'] = k % 2 === 0 ? 'sms' : 'email'
    rows.push(
      row({
        id: `${channel}:old-${String(k).padStart(4, '0')}`,
        customer_id: `old${k % 15}`,
        channel,
        direction: 'inbound',
        created_at: at(10_000 + k),
      }),
    )
  }
  return rows
}

async function compare(all: Row[], seed: number, unmatchedCount = 3) {
  const { recent, unread } = oldViewReads(all)
  const expected = oldGetInboxReference(recent, unread, unmatchedCount)
  const { rpc, from } = mockAdminClient(functionRows(all, seed), unmatchedCount)

  const actual = await CommunicationsService.getInbox()

  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('get_inbox_communications', {
    p_recent_limit: RECENT_LIMIT,
    p_unread_limit: UNREAD_LIMIT,
  })
  expect(from).not.toHaveBeenCalledWith('customer_communications')

  expect(actual.conversations.map(c => c.customer.id)).toEqual(expected.conversations.map(c => c.customer.id))
  expect(actual.conversations.map(c => c.unreadCount)).toEqual(expected.conversations.map(c => c.unreadCount))
  expect(actual).toEqual(expected)
  return { actual, expected, unread }
}

describe('CommunicationsService.getInbox through get_inbox_communications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches the old two-view-read inbox on a mixed fixture, whatever order rows arrive in', async () => {
    const all = buildFixture(40)
    for (const seed of [1, 7, 42]) {
      const { actual, unread } = await compare(all, seed)
      expect(actual.unreadIsCapped).toBe(false)
      expect(unread.length).toBeGreaterThan(40)
      // Unread rows older than the recent window still reach the inbox.
      expect(actual.conversations.some(c => c.customer.id.startsWith('old'))).toBe(true)
    }
  })

  it('marks the unread list capped at exactly 500 unread rows, as before', async () => {
    const all = buildFixture(0)
    const inWindowUnread = all.filter(isUnreadRow).length
    const capped = [...all, ...buildFixture(UNREAD_LIMIT - inWindowUnread).slice(320)]
    const { actual, unread } = await compare(capped, 3)
    expect(unread.length).toBe(UNREAD_LIMIT)
    expect(actual.unreadIsCapped).toBe(true)
    expect(actual.hasMoreUnread).toBe(true)
  })

  it('is not capped at 499 unread rows', async () => {
    const all = buildFixture(0)
    const inWindowUnread = all.filter(isUnreadRow).length
    const nearly = [...all, ...buildFixture(UNREAD_LIMIT - 1 - inWindowUnread).slice(320)]
    const { actual, unread } = await compare(nearly, 5)
    expect(unread.length).toBe(UNREAD_LIMIT - 1)
    expect(actual.unreadIsCapped).toBe(false)
  })

  it('still fails loudly when the inbox read fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 0, error: null })) })),
    }))
    mockedCreateAdminClient.mockReturnValue({ rpc, from })
    await expect(CommunicationsService.getInbox()).rejects.toThrow('Failed to load messages')
  })
})
