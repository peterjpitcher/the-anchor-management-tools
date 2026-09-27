// The kiosk page tells the client which load failed, so a failure is never drawn as an empty
// grid or as everyone "Not clocked in".

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const EMPLOYEE = { employee_id: 'e1', first_name: 'Mandy', last_name: 'Jones', preferred_name: null }

async function propsFor(): Promise<Record<string, unknown>> {
  const element = await TimeclockPage()
  const { type, props } = element as { type: (p: unknown) => unknown; props: Record<string, unknown> }
  type(props)
  return mocks.clientProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('timeclock page load failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.employeesResult = { data: [EMPLOYEE], error: null }
    mocks.getOpenSessions.mockResolvedValue({ success: true, data: [] })
  })

  it('reports no failure when both loads work', async () => {
    const props = await propsFor()

    expect(props.employeesLoadFailed).toBe(false)
    expect(props.sessionsLoadFailed).toBe(false)
    expect(props.employees).toEqual([EMPLOYEE])
  })

  it('flags a failed employee load', async () => {
    mocks.employeesResult = { data: null, error: { message: 'timeout' } }

    const props = await propsFor()

    expect(props.employeesLoadFailed).toBe(true)
    expect(props.sessionsLoadFailed).toBe(false)
  })

  it('flags a failed session load', async () => {
    mocks.getOpenSessions.mockResolvedValue({ success: false, error: 'timeout' })

    const props = await propsFor()

    expect(props.sessionsLoadFailed).toBe(true)
    expect(props.openSessions).toEqual([])
  })
})
