// The edit employee page when the employee cannot be loaded (FF-35).
//
// The page checked "no data" before it checked the error, and a failed load carries no data, so
// a database outage showed staff a 404 for an employee who exists. The error is now checked
// first and shown under the page header; a real not-found still 404s.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
}))

vi.mock('next/navigation', () => ({
  notFound,
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/e1/edit',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/actions/employeeDetails', () => ({
  getEmployeeEditData: vi.fn(),
}))

vi.mock('@/app/(authenticated)/employees/[employee_id]/edit/EmployeeEditClient', () => ({
  default: () => <p>Edit form</p>,
}))

import { getEmployeeEditData } from '@/app/actions/employeeDetails'
import EditEmployeePage from '@/app/(authenticated)/employees/[employee_id]/edit/page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('edit employee page load states', () => {
  it('shows a load failure as an error, not a 404', async () => {
    ;(getEmployeeEditData as Mock).mockResolvedValue({ error: 'Failed to fetch employee details.' })

    render(await EditEmployeePage({ params: Promise.resolve({ employee_id: 'e1' }) }))

    expect(notFound).not.toHaveBeenCalled()
    expect(screen.getAllByText('Edit Employee').length).toBeGreaterThan(0)
    expect(screen.getByText(/This employee could not be loaded/)).toBeInTheDocument()
  })

  it('still 404s for an employee who does not exist', async () => {
    ;(getEmployeeEditData as Mock).mockResolvedValue({ notFound: true })

    await expect(EditEmployeePage({ params: Promise.resolve({ employee_id: 'missing' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})
