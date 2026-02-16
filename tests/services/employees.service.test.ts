import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { EmployeeService } from '@/services/employees'

describe('EmployeeService delete safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when employee update affects no rows after prefetch', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        status: 'Former',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        update: vi.fn().mockReturnValue({ eq: updateEq }),
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(
      EmployeeService.updateEmployee('employee-1', {
        first_name: 'Alex',
        last_name: 'Rowe',
        email_address: 'alex@example.com',
        job_title: 'Server',
        employment_start_date: '2026-02-14',
        status: 'Active',
      })
    ).rejects.toThrow('Employee not found or failed to update.')
  })

  it('throws when employee delete affects no rows after prefetch', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        employee_id: 'employee-1',
        date_of_birth: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    const mockFrom = vi.fn((table: string) => {
      if (table !== 'employees') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({ eq: fetchEq }),
        delete: vi.fn().mockReturnValue({ eq: deleteEq }),
      }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: { from: vi.fn() },
    })

    await expect(EmployeeService.deleteEmployee('employee-1')).rejects.toThrow(
      'Employee not found or failed to delete.'
    )
  })

  it('deletes attachment files using the DB storage path, not caller input', async () => {
    const mockStorageRemove = vi.fn().mockResolvedValue({ error: null })
    const mockSelectSingle = vi.fn().mockResolvedValue({
      data: {
        file_name: 'handbook.pdf',
        storage_path: 'employee-1/handbook.pdf',
      },
      error: null,
    })

    const mockSelectEqEmployee = vi.fn().mockReturnValue({ single: mockSelectSingle })
    const mockSelectEqAttachment = vi.fn().mockReturnValue({ eq: mockSelectEqEmployee })
    const mockDeleteEq = vi.fn().mockResolvedValue({ error: null })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'employee_attachments') {
        return {
          select: vi.fn().mockReturnValue({ eq: mockSelectEqAttachment }),
          delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockStorageRemove }),
      },
    })

    await EmployeeService.deleteEmployeeAttachment('attachment-1', 'employee-1')

    expect(mockSelectEqAttachment).toHaveBeenCalledWith('attachment_id', 'attachment-1')
    expect(mockSelectEqEmployee).toHaveBeenCalledWith('employee_id', 'employee-1')
    expect(mockStorageRemove).toHaveBeenCalledWith(['employee-1/handbook.pdf'])
  })

  it('restores the DB photo path when right-to-work storage delete fails', async () => {
    const mockStorageRemove = vi.fn().mockResolvedValue({
      error: { message: 'storage temporarily unavailable' },
    })

    const mockSelectSingle = vi.fn().mockResolvedValue({
      data: { photo_storage_path: 'employee-1/rtw-proof.pdf' },
      error: null,
    })
    const mockSelectEq = vi.fn().mockReturnValue({ single: mockSelectSingle })

    const mockClearSelect = vi.fn().mockResolvedValue({
      data: [{ employee_id: 'employee-1' }],
      error: null,
    })
    const mockClearEqPhoto = vi.fn().mockReturnValue({ select: mockClearSelect })
    const mockClearEqEmployee = vi.fn().mockReturnValue({ eq: mockClearEqPhoto })

    const mockRollbackIs = vi.fn().mockResolvedValue({ error: null })
    const mockRollbackEqEmployee = vi.fn().mockReturnValue({ is: mockRollbackIs })

    const mockUpdate = vi.fn((payload: { photo_storage_path: string | null }) => {
      if (payload.photo_storage_path === null) {
        return { eq: mockClearEqEmployee }
      }

      return { eq: mockRollbackEqEmployee }
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'employee_right_to_work') {
        return {
          select: vi.fn().mockReturnValue({ eq: mockSelectEq }),
          update: mockUpdate,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: mockFrom,
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockStorageRemove }),
      },
    })

    await expect(EmployeeService.deleteRightToWorkPhoto('employee-1')).rejects.toThrow(
      'Failed to delete photo from storage.'
    )

    expect(mockStorageRemove).toHaveBeenCalledWith(['employee-1/rtw-proof.pdf'])
    expect(mockUpdate).toHaveBeenCalledWith({ photo_storage_path: null })
    expect(mockUpdate).toHaveBeenCalledWith({ photo_storage_path: 'employee-1/rtw-proof.pdf' })
    expect(mockRollbackIs).toHaveBeenCalledWith('photo_storage_path', null)
  })
})
