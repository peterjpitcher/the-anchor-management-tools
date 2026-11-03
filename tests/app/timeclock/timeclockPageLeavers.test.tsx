// The public kiosk lists someone on notice up to and including their last working day. After
// that they are gone, unless they are still clocked in from it and need to clock out. Their
// status and last working day are never handed to the public client.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  employeesResult: { data: [] as unknown[] | null, error: null as { message: string } | null },
  getOpenSessions: vi.fn(),
  clientProps: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({
          order: () => ({
            order: async () => mocks.employeesResult,
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/app/actions/timeclock', () => ({
  getOpenSessions: mocks.getOpenSessions,
}))

vi.mock('@/app/(timeclock)/timeclock/_components/TimeclockClient', () => ({
  default: (props: unknown) => {
    mocks.clientProps(props)
    return null
  },
}))

import TimeclockPage from '@/app/(timeclock)/timeclock/page'

const LAST_DAY = '2026-11-07'
const ADA = { employee_id: 'ada', first_name: 'Ada', last_name: 'Active', preferred_name: null, status: 'Active', employment_end_date: null }
const SAM = { employee_id: 'sam', first_name: 'Sam', last_name: 'Taylor', preferred_name: null, status: 'Started Separation', employment_end_date: LAST_DAY }

async function listedIds(): Promise<string[]> {
  const element = await TimeclockPage()
  const { type, props } = element as { type: (p: unknown) => unknown; props: Record<string, unknown> }
  type(props)
  const clientProps = mocks.clientProps.mock.calls.at(-1)?.[0] as { employees: Array<Record<string, unknown>> }
  for (const employee of clientProps.employees) {
    expect(Object.keys(employee).sort()).toEqual(['employee_id', 'first_name', 'last_name', 'preferred_name'])
  }
  return clientProps.employees.map((employee) => employee.employee_id as string)
}

function setLondonNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('the kiosk list and someone on notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.employeesResult = { data: [ADA, SAM], error: null }
    mocks.getOpenSessions.mockResolvedValue({ success: true, data: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists them on their last working day', async () => {
    setLondonNow(`${LAST_DAY}T20:00:00.000Z`)
    expect(await listedIds()).toEqual(['ada', 'sam'])
  })

  it('drops them the day after', async () => {
    setLondonNow('2026-11-08T09:00:00.000Z')
    expect(await listedIds()).toEqual(['ada'])
  })

  it('keeps them while they are still clocked in, so they can clock out', async () => {
    setLondonNow('2026-11-08T00:30:00.000Z')
    mocks.getOpenSessions.mockResolvedValue({
      success: true,
      data: [{ id: 's1', employee_id: 'sam', clock_in_at: `${LAST_DAY}T18:00:00.000Z`, employee_name: 'Sam' }],
    })
    expect(await listedIds()).toEqual(['ada', 'sam'])
  })
})
