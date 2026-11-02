'use server'

import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import type { Employee } from '@/types/database'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { checkUserPermission } from './rbac'
import { EmployeeService } from '@/services/employees'
import { getErrorMessage } from '@/lib/errors';

interface ExportOptions {
  format: 'csv' | 'json'
  includeFields?: string[]
  statusFilter?: 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation'
  /** The roster's search box, so the file holds the people the list is showing. */
  searchTerm?: string
}

/**
 * `count` is the number of people in the file. The roster used to report the number on the
 * page it was showing, which is not the same once there is more than one page.
 */
export async function exportEmployees(options: ExportOptions): Promise<{ data?: string; error?: string; filename?: string; count?: number }> {
  const hasPermission = await checkUserPermission('employees', 'export')
  if (!hasPermission) {
    return { error: 'You do not have permission to export employees.' }
  }

  try {
    const employees = await EmployeeService.exportEmployeesData(options)

    if (!employees || employees.length === 0) {
      return { error: 'No employees found to export' }
    }

    // Audit log the export
    const userInfo = await getCurrentUser()
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'export',
      resource_type: 'employee',
      operation_status: 'success',
      additional_info: {
        format: options.format,
        recordCount: employees.length,
        statusFilter: options.statusFilter,
        searchTerm: options.searchTerm || undefined
      }
    })

    // Generate export based on format
    let exportData: string
    let filename: string
    const timestamp = getTodayIsoDate()

    if (options.format === 'csv') {
      exportData = EmployeeService.generateCSV(employees, options.includeFields)
      filename = `employees_export_${timestamp}.csv`
    } else {
      exportData = EmployeeService.generateJSON(employees, options.includeFields)
      filename = `employees_export_${timestamp}.json`
    }

    return { data: exportData, filename, count: employees.length }
  } catch (error: unknown) {
    console.error('Export error:', error)
    return { error: getErrorMessage(error) }
  }
}